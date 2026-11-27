import { SCHEMA } from '@dayplanner/core';
import { column, Schema, Table } from '@powersync/web';

/** Built from the core's column lists, which an API test keeps equal to the Postgres DDL. */
const tables = Object.fromEntries(
  Object.entries(SCHEMA).map(([name, cols]) => [
    name,
    new Table(
      Object.fromEntries(Object.entries(cols).map(([c, type]) => [c, column[type]])),
      name === 'tasks' ? { indexes: { by_date: ['date'], by_event: ['event_id'], by_parent: ['parent_id'] } } : {},
    ),
  ]),
);

export const AppSchema = new Schema(tables);
