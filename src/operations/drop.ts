import { DROP_COLLECTION, DROP_DATABASE } from '.././constants';
import type { Document } from '../bson';
import type { Db } from '../db';
import { MONGODB_ERROR_CODES, MongoServerError } from '../error';
import type { Server } from '../sdam/server';
import type { ClientSession } from '../sessions';
import { CommandOperation, type CommandOperationOptions } from './command';
import { Aspect, defineAspects } from './operation';

/** @public */
export interface DropCollectionOptions extends CommandOperationOptions {
  /** @experimental */
  encryptedFields?: Document;
}

/** @internal */
export class DropCollectionOperation extends CommandOperation<boolean> {
  /** @internal */
  name = DROP_COLLECTION;
  override options: DropCollectionOptions;
  db: Db;
  collName: string;

  constructor(db: Db, name: string, options: DropCollectionOptions = {}) {
    super(db, options);
    this.db = db;
    this.options = options;
    this.collName = name;
  }

  override async execute(server: Server, session: ClientSession | undefined): Promise<boolean> {
    const db = this.db;
    const options = this.options;
    const name = this.collName;

    const encryptedFieldsMap = db.client.options.autoEncryption?.encryptedFieldsMap;
    let encryptedFields: Document | undefined =
      options.encryptedFields ?? encryptedFieldsMap?.[`${db.databaseName}.${name}`];

    if (!encryptedFields && encryptedFieldsMap) {
      // If the MongoClient was configured with an encryptedFieldsMap,
      // and no encryptedFields config was available in it or explicitly
      // passed as an argument, the spec tells us to look one up using
      // listCollections().
      const listCollectionsResult = await db
        .listCollections({ name }, { nameOnly: false })
        .toArray();
      encryptedFields = listCollectionsResult?.[0]?.options?.encryptedFields;
    }

    if (encryptedFields) {
      const escCollection = encryptedFields.escCollection || `enxcol_.${name}.esc`;
      const ecocCollection = encryptedFields.ecocCollection || `enxcol_.${name}.ecoc`;

      for (const collectionName of [escCollection, ecocCollection]) {
        // Drop auxilliary collections, ignoring potential NamespaceNotFound errors.
        const dropOp = new DropCollectionOperation(db, collectionName);
        try {
          await dropOp.executeWithoutEncryptedFieldsCheck(server, session);
        } catch (err) {
          if (
            !(err instanceof MongoServerError) ||
            err.code !== MONGODB_ERROR_CODES.NamespaceNotFound
          ) {
            throw err;
          }
        }
      }
    }

    return this.executeWithoutEncryptedFieldsCheck(server, session);
  }

  private async executeWithoutEncryptedFieldsCheck(
    server: Server,
    session: ClientSession | undefined
  ): Promise<boolean> {
    await super.executeCommand(server, session, { drop: this.collName });
    return true;
  }
}

/** @public */
export type DropDatabaseOptions = CommandOperationOptions;

/** @internal */
export class DropDatabaseOperation extends CommandOperation<boolean> {
  /** @internal */
  name = DROP_DATABASE;
  override options: DropDatabaseOptions;

  constructor(db: Db, options: DropDatabaseOptions) {
    super(db, options);
    this.options = options;
  }
  override async execute(server: Server, session: ClientSession | undefined): Promise<boolean> {
    await super.executeCommand(server, session, { dropDatabase: 1 });
    return true;
  }
}

defineAspects(DropCollectionOperation, [Aspect.WRITE_OPERATION]);
defineAspects(DropDatabaseOperation, [Aspect.WRITE_OPERATION]);
