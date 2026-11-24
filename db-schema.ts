import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const conversations = sqliteTable('conversations', {id:text('id').primaryKey(),owner:text('owner').notNull(),version:integer('version').notNull().default(0),createdAt:text('created_at').notNull(),lastRequest:text('last_request').notNull().default('')});
export const tickets = sqliteTable('tickets', {
 id:text('id').primaryKey(), conversationId:text('conversation_id').notNull(), owner:text('owner').notNull(), subject:text('subject').notNull(),
 description:text('description').notNull(), area:text('area').notNull(), status:text('status').notNull().default('open'),
 severity:integer('severity').notNull().default(3), severityReason:text('severity_reason').notNull(),
 factors:text('factors').notNull(), diagnosis:text('diagnosis').notNull(), assignee:text('assignee').notNull().default(''),
 createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(), version:integer('version').notNull().default(1),lastUpdate:text('last_update').notNull().default(''),
},t=>[uniqueIndex('tickets_conversation').on(t.conversationId), index('tickets_owner').on(t.owner), index('tickets_queue').on(t.status,t.severity,t.updatedAt)]);
export const messages = sqliteTable('messages', {
 id:text('id').primaryKey(), conversationId:text('conversation_id').notNull(), ticketId:text('ticket_id').references(()=>tickets.id), owner:text('owner').notNull(),
 role:text('role').notNull(), content:text('content').notNull(), internal:integer('internal').notNull().default(0), createdAt:text('created_at').notNull(),
},t=>[index('messages_ticket').on(t.ticketId,t.createdAt)]);
export const events = sqliteTable('events', {
 id:text('id').primaryKey(), ticketId:text('ticket_id').notNull().references(()=>tickets.id),
 actor:text('actor').notNull(), details:text('details').notNull(), createdAt:text('created_at').notNull(),
},t=>[index('events_ticket').on(t.ticketId,t.createdAt)]);
export const staff = sqliteTable('staff', { id:text('id').primaryKey(), label:text('label').notNull() });
export const requests = sqliteTable('requests', {
 id:text('id').primaryKey(), owner:text('owner').notNull(), fingerprint:text('fingerprint').notNull(),
 response:text('response'), createdAt:text('created_at').notNull(),
},t=>[index('requests_owner_date').on(t.owner,t.createdAt)]);
