// Generates the importable workflows in examples/ from one description, so the SQL in the
// workflows always matches sql/schema.sql. Run with: node scripts/build-examples.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const referenceSchema = readFileSync(join(root, 'sql', 'schema.sql'), 'utf8');

/** The reference schema for another table name and embedding size, without comments. */
function schemaFor(table, dimensions) {
	let sql = referenceSchema
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n')
		.replaceAll('documents', table)
		.replace('vector(1536)', `vector(${dimensions})`);
	if (dimensions > 2000) {
		// pgvector cannot build an HNSW index on a vector column above 2000 dimensions.
		sql = sql.replace(/CREATE INDEX IF NOT EXISTS \w+_embedding_idx[^;]+;\n/, '');
	}
	return sql.replace(/\n{3,}/g, '\n\n').trim();
}

let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const node = (name, type, typeVersion, position, parameters = {}, extra = {}) => ({
	parameters,
	id: id(),
	name,
	type,
	typeVersion,
	position,
	...extra,
});
const note = (name, position, width, height, content, color = 7) =>
	node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, width, height, color });
const credential = (type, label) => ({
	credentials: { [type]: { id: 'REPLACE_ME', name: label } },
});
const main = (...targets) => ({
	main: [targets.map((target) => ({ node: target, type: 'main', index: 0 }))],
});
const ai = (type, target) => ({ [type]: [[{ node: target, type, index: 0 }]] });
const assignments = (fields) => ({
	assignments: {
		assignments: Object.entries(fields).map(([name, [value, type]]) => ({
			id: id(),
			name,
			value,
			type,
		})),
	},
	options: {},
});
const columnNames = {
	values: {
		idColumnName: 'id',
		vectorColumnName: 'embedding',
		contentColumnName: 'content',
		metadataColumnName: 'metadata',
	},
};
const metadata = (values) => ({
	metadataValues: Object.entries(values).map(([name, value]) => ({ name, value })),
});

const PRISMA = credential('prismaApi', 'Prisma account');
const POSTGRES = credential('postgres', 'Prisma Postgres');
const GEMINI = credential('googlePalmApi', 'Google Gemini(PaLM) Api account');
const OPENAI = credential('openAiApi', 'OpenAi account');
const GMAIL = credential('gmailOAuth2', 'Gmail account');
const NOTION = credential('notionApi', 'Notion account');

// ---------------------------------------------------------------------------
// 1. Create a Prisma Postgres database
// ---------------------------------------------------------------------------
function createDatabase() {
	counter = 1000;
	const nodes = [
		note(
			'About',
			[-500, -280],
			440,
			560,
			'## Create a Prisma Postgres database\n\nThis workflow creates a project with its first database and then generates the credentials you need to connect to it.\n\n**How to use it**\n\n1. Add a **Prisma API** credential that holds a workspace service token.\n2. Run the workflow.\n3. Open **Create connection** and copy the host, port, database, user and password into a new **Postgres** credential, with **SSL** set to **Require**.\n\nThe password only appears in **Create connection**, and **Database details** leaves it out so that later nodes do not carry it around.\n\nKeep in mind that every run creates a new project, which you can remove again with **Project > Delete**.',
		),
		node('When clicking ‘Execute workflow’', 'n8n-nodes-base.manualTrigger', 1, [0, 0]),
		node(
			'Create project and database',
			'@prisma/n8n-nodes-prisma.prismaPostgres',
			1,
			[220, 0],
			{
				resource: 'project',
				operation: 'create',
				name: 'n8n-ai-context',
				region: 'us-east-1',
				options: {},
			},
			PRISMA,
		),
		node(
			'Create connection',
			'@prisma/n8n-nodes-prisma.prismaPostgres',
			1,
			[440, 0],
			{
				resource: 'connection',
				operation: 'create',
				databaseId: { __rl: true, mode: 'id', value: '={{ $json.database.id }}' },
				name: 'n8n',
				endpointType: 'pooled',
			},
			PRISMA,
		),
		node(
			'Database details',
			'n8n-nodes-base.set',
			3.5,
			[660, 0],
			assignments({
				projectId: ["={{ $('Create project and database').item.json.id }}", 'string'],
				projectName: ["={{ $('Create project and database').item.json.name }}", 'string'],
				databaseId: ['={{ $json.databaseId }}', 'string'],
				databaseStatus: [
					"={{ $('Create project and database').item.json.database.status }}",
					'string',
				],
				region: ["={{ $('Create project and database').item.json.database.region.id }}", 'string'],
				connectionId: ['={{ $json.id }}', 'string'],
				host: ['={{ $json.host }}', 'string'],
				port: ['={{ $json.port }}', 'number'],
				database: ['={{ $json.database }}', 'string'],
				user: ['={{ $json.user }}', 'string'],
				ssl: ['={{ $json.ssl }}', 'string'],
			}),
		),
	];
	return {
		name: 'Create a Prisma Postgres database',
		nodes,
		connections: {
			'When clicking ‘Execute workflow’': main('Create project and database'),
			'Create project and database': main('Create connection'),
			'Create connection': main('Database details'),
		},
		settings: { executionOrder: 'v1' },
	};
}

// ---------------------------------------------------------------------------
// 2. Accounts inbox with pgvector and Gemini
// ---------------------------------------------------------------------------
const SUGGESTIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS inbox_suggestions (
	id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	message_id  text NOT NULL UNIQUE,
	sender      text,
	subject     text,
	status      text NOT NULL CHECK (status IN ('pending_review', 'suggested', 'approved', 'rejected')),
	analysis    jsonb NOT NULL,
	created_at  timestamptz NOT NULL DEFAULT now(),
	reviewed_at timestamptz,
	reviewed_by text
);`;

const SAVE_SUGGESTION = `INSERT INTO inbox_suggestions (message_id, sender, subject, status, analysis)
VALUES (
	$1, $2, $3,
	CASE WHEN ($4::jsonb ->> 'requires_human_review')::boolean THEN 'pending_review' ELSE 'suggested' END,
	$4::jsonb
)
ON CONFLICT (message_id) DO UPDATE
	SET analysis = EXCLUDED.analysis, status = EXCLUDED.status
RETURNING id, message_id, status, analysis ->> 'suggested_action' AS suggested_action;`;

const ANALYSIS_EXAMPLE = {
	category: 'invoice',
	vendor: 'Acme GmbH',
	amount: 1250.5,
	currency: 'EUR',
	due_date: '2026-12-01',
	summary: 'Invoice 4471 from Acme GmbH for November hosting.',
	suggested_action: 'Schedule payment for 2026-11-28 from the operating account.',
	confidence: 0.82,
	requires_human_review: true,
	review_reasons: ['Amount is above the 1000 EUR approval limit'],
};

function accountsInbox() {
	counter = 2000;
	const vectorStore = (name, position, parameters) =>
		node(name, '@n8n/n8n-nodes-langchain.vectorStorePGVector', 1.4, position, parameters, POSTGRES);
	const nodes = [
		note(
			'About',
			[-520, -420],
			460,
			820,
			'## Accounts inbox with pgvector and Gemini\n\nEvery new email is analyzed by Gemini with the help of context stored in Prisma Postgres, and the result is saved as a suggestion for a person to review.\n\n**Setup**\n\n1. Create a database with the Prisma Postgres node and add a **Postgres** credential for it, with **SSL** set to **Require**.\n2. Add your **Google Gemini** and **Gmail** credentials.\n3. Run the **Setup** row once, which creates the tables and stores a few sample notes.\n4. Activate the workflow.\n\n**Safety**\n\nThe workflow never pays, replies or deletes anything, because all it does is write a suggestion to `inbox_suggestions`. Suggestions that need a person get the status `pending_review`.\n\n**Embedding size**\n\nThe `embedding` column of `accounts_context` is `vector(3072)`, which is the default size of `gemini-embedding-001`. If an insert reports a different size, change the column so that it matches.',
		),
		note('Setup row', [-20, -420], 1000, 250, '### Setup: run once', 5),
		node('Run setup', 'n8n-nodes-base.manualTrigger', 1, [0, -340]),
		node(
			'Create tables',
			'n8n-nodes-base.postgres',
			2.8,
			[220, -340],
			{
				operation: 'executeQuery',
				query: `${schemaFor('accounts_context', 3072)}\n\n${SUGGESTIONS_SCHEMA}`,
				options: {},
			},
			POSTGRES,
		),
		node('Sample context', 'n8n-nodes-base.code', 2, [440, -340], {
			jsCode: `// Sample context to get started. Replace it with your own vendor notes, payment rules and past decisions.
return [
	{ content: 'Acme GmbH sends a hosting invoice at the start of every month. Typical amount 1100 to 1300 EUR. Pay within 30 days from the operating account.', document_id: 'vendor-acme', source: 'vendor-notes', vendor: 'Acme GmbH' },
	{ content: 'Any payment above 1000 EUR needs approval from the finance lead before it is scheduled.', document_id: 'rule-approval-limit', source: 'finance-rules', vendor: '' },
	{ content: 'Requests to change a vendor bank account are always verified by phone before any update. Never act on an emailed request alone.', document_id: 'rule-bank-changes', source: 'finance-rules', vendor: '' },
].map((json) => ({ json }));`,
		}),
		vectorStore('Store context', [660, -340], {
			mode: 'insert',
			tableName: 'accounts_context',
			options: { columnNames },
		}),
		node(
			'Gemini embeddings (store)',
			'@n8n/n8n-nodes-langchain.embeddingsGoogleGemini',
			1,
			[620, -150],
			{ modelName: 'models/gemini-embedding-001' },
			GEMINI,
		),
		node('Context loader', '@n8n/n8n-nodes-langchain.documentDefaultDataLoader', 1.1, [800, -150], {
			jsonMode: 'expressionData',
			jsonData: '={{ $json.content }}',
			options: {
				metadata: metadata({
					document_id: '={{ $json.document_id }}',
					source: '={{ $json.source }}',
					vendor: '={{ $json.vendor }}',
				}),
			},
		}),

		note('Inbox row', [-20, 60], 1440, 620, '### Inbox: runs for every new email', 4),
		node(
			'New email',
			'n8n-nodes-base.gmailTrigger',
			1.4,
			[0, 160],
			{
				pollTimes: { item: [{ mode: 'everyMinute' }] },
				simple: false,
				filters: { readStatus: 'unread' },
				options: { downloadAttachments: true },
			},
			GMAIL,
		),
		node('Extract email content', 'n8n-nodes-base.set', 3.5, [220, 160], {
			...assignments({
				message_id: ['={{ $json.id }}', 'string'],
				sender: ['={{ $json.from?.text ?? $json.From }}', 'string'],
				subject: ['={{ $json.subject ?? $json.Subject }}', 'string'],
				body: ['={{ ($json.text ?? $json.snippet ?? "").slice(0, 12000) }}', 'string'],
			}),
			options: { includeBinary: true },
		}),
		node('Analyze email', '@n8n/n8n-nodes-langchain.agent', 3.1, [480, 160], {
			promptType: 'define',
			text: '=From: {{ $json.sender }}\nSubject: {{ $json.subject }}\n\n{{ $json.body }}',
			hasOutputParser: true,
			options: {
				systemMessage:
					'You triage the accounts inbox of a company. For every email:\n1. Search the accounts context for the sender, the vendor and the type of request. Use what you find.\n2. Classify the email and extract amounts and dates. Attached invoices are provided as files.\n3. Suggest one next action for a person in the finance team.\n\nSet requires_human_review to true when money would move, when bank or contact details change, when the context is missing or contradicts the email, or when your confidence is below 0.8. You never take the action yourself.',
				passthroughBinaryImages: true,
				passthroughBinaryPdfs: true,
				forceToolCallOnFirstIteration: true,
			},
		}),
		node(
			'Gemini chat model',
			'@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
			1.2,
			[400, 400],
			{ modelName: 'models/gemini-2.5-flash', options: { temperature: 0.1 } },
			GEMINI,
		),
		vectorStore('Search accounts context', [560, 400], {
			mode: 'retrieve-as-tool',
			toolDescription:
				'Searches the stored accounts context, which holds vendor notes, payment rules and past decisions. Call it with a short description of the email.',
			tableName: 'accounts_context',
			topK: 5,
			includeDocumentMetadata: true,
			options: { columnNames },
		}),
		node(
			'Gemini embeddings (search)',
			'@n8n/n8n-nodes-langchain.embeddingsGoogleGemini',
			1,
			[560, 560],
			{ modelName: 'models/gemini-embedding-001' },
			GEMINI,
		),
		node('Analysis format', '@n8n/n8n-nodes-langchain.outputParserStructured', 1.3, [780, 400], {
			schemaType: 'fromJson',
			jsonSchemaExample: JSON.stringify(ANALYSIS_EXAMPLE, null, 2),
		}),
		node(
			'Save suggestion',
			'n8n-nodes-base.postgres',
			2.8,
			[860, 160],
			{
				operation: 'executeQuery',
				query: SAVE_SUGGESTION,
				options: {
					queryReplacement:
						"={{ [ $('Extract email content').item.json.message_id, $('Extract email content').item.json.sender, $('Extract email content').item.json.subject, JSON.stringify($json.output) ] }}",
				},
			},
			POSTGRES,
		),
		node('Needs human review?', 'n8n-nodes-base.if', 2.4, [1080, 160], {
			conditions: {
				options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
				conditions: [
					{
						id: id(),
						leftValue: '={{ $json.status }}',
						rightValue: 'pending_review',
						operator: { type: 'string', operation: 'equals' },
					},
				],
				combinator: 'and',
			},
			options: {},
		}),
		node(
			'Ask a person to review',
			'n8n-nodes-base.noOp',
			1,
			[1300, 80],
			{},
			{
				notes:
					'Replace this node with Slack, email or a form that lets a person set the status to approved or rejected.',
				notesInFlow: true,
			},
		),
		node('Suggestion saved', 'n8n-nodes-base.noOp', 1, [1300, 260]),
	];
	return {
		name: 'Accounts inbox with pgvector and Gemini',
		nodes,
		connections: {
			'Run setup': main('Create tables'),
			'Create tables': main('Sample context'),
			'Sample context': main('Store context'),
			'Gemini embeddings (store)': ai('ai_embedding', 'Store context'),
			'Context loader': ai('ai_document', 'Store context'),
			'New email': main('Extract email content'),
			'Extract email content': main('Analyze email'),
			'Gemini chat model': ai('ai_languageModel', 'Analyze email'),
			'Search accounts context': ai('ai_tool', 'Analyze email'),
			'Gemini embeddings (search)': ai('ai_embedding', 'Search accounts context'),
			'Analysis format': ai('ai_outputParser', 'Analyze email'),
			'Analyze email': main('Save suggestion'),
			'Save suggestion': main('Needs human review?'),
			'Needs human review?': {
				main: [
					[{ node: 'Ask a person to review', type: 'main', index: 0 }],
					[{ node: 'Suggestion saved', type: 'main', index: 0 }],
				],
			},
		},
		settings: { executionOrder: 'v1' },
	};
}

// ---------------------------------------------------------------------------
// 3. Notion policy knowledge base
// ---------------------------------------------------------------------------
function policyKnowledgeBase() {
	counter = 3000;
	const vectorStore = (name, position, parameters) =>
		node(name, '@n8n/n8n-nodes-langchain.vectorStorePGVector', 1.4, position, parameters, POSTGRES);
	const embeddings = (name, position) =>
		node(
			name,
			'@n8n/n8n-nodes-langchain.embeddingsOpenAi',
			1.2,
			position,
			{ model: 'text-embedding-3-small', options: {} },
			OPENAI,
		);
	const nodes = [
		note(
			'About',
			[-520, -420],
			460,
			800,
			'## Notion policy knowledge base\n\nPolicies from Notion are stored in Prisma Postgres with OpenAI embeddings, so that a chat can answer questions about them and draft updates.\n\n**Setup**\n\n1. Create a database with the Prisma Postgres node and add a **Postgres** credential for it, with **SSL** set to **Require**.\n2. Add your **Notion** and **OpenAI** credentials, and share the policies database with your Notion integration.\n3. Select the policies database in **Get policies**.\n4. Run **Run sync now** once, which creates the table and loads every policy.\n5. Open the chat to ask questions or to draft a policy update.\n\n**Embedding size**\n\nThe `embedding` column of `policy_documents` is `vector(1536)`, which is the size of `text-embedding-3-small`.\n\nAnswers and drafts are returned for you to review, and nothing is written back to Notion.',
		),
		note('Sync row', [-20, -420], 1900, 420, '### Sync: Notion to Prisma Postgres', 5),
		node('Every night', 'n8n-nodes-base.scheduleTrigger', 1.4, [0, -340], {
			rule: { interval: [{ triggerAtHour: 2 }] },
		}),
		node('Run sync now', 'n8n-nodes-base.manualTrigger', 1, [0, -180]),
		node(
			'Create table',
			'n8n-nodes-base.postgres',
			2.8,
			[220, -260],
			{ operation: 'executeQuery', query: schemaFor('policy_documents', 1536), options: {} },
			POSTGRES,
		),
		node(
			'Get policies',
			'n8n-nodes-base.notion',
			2.2,
			[440, -260],
			{
				resource: 'databasePage',
				operation: 'getAll',
				databaseId: { __rl: true, mode: 'list', value: '' },
				returnAll: true,
				simple: true,
				options: {},
			},
			{ ...NOTION, executeOnce: true },
		),
		node('For each policy', 'n8n-nodes-base.splitInBatches', 3, [660, -260], {
			batchSize: 1,
			options: {},
		}),
		node(
			'Get policy text',
			'n8n-nodes-base.notion',
			2.2,
			[880, -180],
			{
				resource: 'block',
				operation: 'getAll',
				blockId: { __rl: true, mode: 'id', value: '={{ $json.id }}' },
				returnAll: true,
				fetchNestedBlocks: true,
				simplifyOutput: true,
			},
			{ ...NOTION, alwaysOutputData: true },
		),
		node('Policy document', 'n8n-nodes-base.code', 2, [1100, -180], {
			jsCode: `// Builds one item per policy that combines the page fields with the text of all its blocks.
const page = $('For each policy').first().json;
const text = $input.all().map((item) => item.json.content).filter(Boolean).join('\\n');
return [{
	json: {
		document_id: page.id,
		title: page.name ?? page.property_name ?? 'Untitled policy',
		url: page.url ?? '',
		text: text || (page.name ?? ''),
	},
}];`,
		}),
		node(
			'Remove old version',
			'n8n-nodes-base.postgres',
			2.8,
			[1320, -180],
			{
				operation: 'executeQuery',
				query: 'DELETE FROM policy_documents WHERE document_id = $1;',
				options: { queryReplacement: '={{ [ $json.document_id ] }}' },
			},
			POSTGRES,
		),
		vectorStore('Store policy', [1540, -180], {
			mode: 'insert',
			tableName: 'policy_documents',
			options: { columnNames },
		}),
		embeddings('OpenAI embeddings (store)', [1500, 0]),
		node('Policy loader', '@n8n/n8n-nodes-langchain.documentDefaultDataLoader', 1.1, [1680, 0], {
			jsonMode: 'expressionData',
			jsonData: "={{ $('Policy document').item.json.text }}",
			options: {
				metadata: metadata({
					document_id: "={{ $('Policy document').item.json.document_id }}",
					source: 'notion',
					title: "={{ $('Policy document').item.json.title }}",
					url: "={{ $('Policy document').item.json.url }}",
				}),
			},
		}),

		note('Ask row', [-20, 240], 1000, 560, '### Ask: answer questions and draft updates', 4),
		node(
			'Chat',
			'@n8n/n8n-nodes-langchain.chatTrigger',
			1.5,
			[0, 340],
			{ options: {} },
			{ webhookId: id() },
		),
		node('Policy assistant', '@n8n/n8n-nodes-langchain.agent', 3.1, [260, 340], {
			options: {
				systemMessage:
					'You answer questions about company policies and draft policy updates.\nAlways search the policy knowledge base first and base your answer only on what it returns. Name the policy title and link for every statement. If the knowledge base has no answer, say so.\nWhen asked to change or write a policy, return a draft and list which existing policies it affects. A person reviews every draft before it is published.',
				forceToolCallOnFirstIteration: true,
			},
		}),
		node(
			'OpenAI chat model',
			'@n8n/n8n-nodes-langchain.lmChatOpenAi',
			1.3,
			[180, 560],
			{ model: { __rl: true, mode: 'list', value: 'gpt-5-mini' }, options: {} },
			OPENAI,
		),
		vectorStore('Search policies', [400, 560], {
			mode: 'retrieve-as-tool',
			toolDescription:
				'Searches the company policy knowledge base. Call it with the question or the topic of the policy.',
			tableName: 'policy_documents',
			topK: 6,
			includeDocumentMetadata: true,
			options: { columnNames },
		}),
		embeddings('OpenAI embeddings (search)', [400, 700]),
	];
	return {
		name: 'Notion policy knowledge base with pgvector and OpenAI',
		nodes,
		connections: {
			'Every night': main('Create table'),
			'Run sync now': main('Create table'),
			'Create table': main('Get policies'),
			'Get policies': main('For each policy'),
			'For each policy': { main: [[], [{ node: 'Get policy text', type: 'main', index: 0 }]] },
			'Get policy text': main('Policy document'),
			'Policy document': main('Remove old version'),
			'Remove old version': main('Store policy'),
			'OpenAI embeddings (store)': ai('ai_embedding', 'Store policy'),
			'Policy loader': ai('ai_document', 'Store policy'),
			'Store policy': main('For each policy'),
			Chat: main('Policy assistant'),
			'OpenAI chat model': ai('ai_languageModel', 'Policy assistant'),
			'Search policies': ai('ai_tool', 'Policy assistant'),
			'OpenAI embeddings (search)': ai('ai_embedding', 'Search policies'),
		},
		settings: { executionOrder: 'v1' },
	};
}

// ---------------------------------------------------------------------------
// 4. Create a database and a matching Postgres credential
// ---------------------------------------------------------------------------
function createDatabaseAndCredential() {
	counter = 4000;
	const nodes = [
		note(
			'About',
			[-500, -280],
			440,
			600,
			'## Create a database and its Postgres credential\n\nThis workflow creates a Prisma Postgres database and then saves a ready-to-use **Postgres** credential in this n8n instance, so nothing has to be copied by hand.\n\n**Setup**\n\n1. Add a **Prisma API** credential.\n2. Create an n8n API key under **Settings > n8n API** with the scope `credential:create`, and add it as an **n8n API** credential.\n3. Run the workflow, and then select the new credential in any Postgres or PGVector Store node.\n\nThe n8n API is not available on every n8n plan, so if you cannot use it, follow example 1 and copy the values instead.\n\nBecause the database password passes through this execution, the workflow is set to not save successful executions.',
		),
		node('When clicking ‘Execute workflow’', 'n8n-nodes-base.manualTrigger', 1, [0, 0]),
		node(
			'Create project and database',
			'@prisma/n8n-nodes-prisma.prismaPostgres',
			1,
			[220, 0],
			{
				resource: 'project',
				operation: 'create',
				name: 'n8n-ai-context',
				region: 'us-east-1',
				options: {},
			},
			PRISMA,
		),
		node(
			'Create connection',
			'@prisma/n8n-nodes-prisma.prismaPostgres',
			1,
			[440, 0],
			{
				resource: 'connection',
				operation: 'create',
				databaseId: { __rl: true, mode: 'id', value: '={{ $json.database.id }}' },
				name: 'n8n',
				endpointType: 'pooled',
			},
			PRISMA,
		),
		node(
			'Create Postgres credential',
			'n8n-nodes-base.n8n',
			1,
			[660, 0],
			{
				resource: 'credential',
				operation: 'create',
				name: "=Prisma Postgres ({{ $('Create project and database').item.json.name }})",
				credentialTypeName: 'postgres',
				data: '={{ JSON.stringify({ host: $json.host, port: $json.port, database: $json.database, user: $json.user, password: $json.password, ssl: "require", allowUnauthorizedCerts: false, sshTunnel: false, maxConnections: 10 }) }}',
			},
			credential('n8nApi', 'n8n account'),
		),
	];
	return {
		name: 'Create a Prisma Postgres database and Postgres credential',
		nodes,
		connections: {
			'When clicking ‘Execute workflow’': main('Create project and database'),
			'Create project and database': main('Create connection'),
			'Create connection': main('Create Postgres credential'),
		},
		settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none' },
	};
}

const files = {
	'1-create-database.json': createDatabase(),
	'2-accounts-inbox-gemini.json': accountsInbox(),
	'3-notion-policy-knowledge-base.json': policyKnowledgeBase(),
	'4-create-database-and-postgres-credential.json': createDatabaseAndCredential(),
};
for (const [file, workflow] of Object.entries(files)) {
	writeFileSync(join(root, 'examples', file), JSON.stringify(workflow, null, 2) + '\n');
	console.log(`examples/${file}: ${workflow.nodes.length} nodes`);
}
