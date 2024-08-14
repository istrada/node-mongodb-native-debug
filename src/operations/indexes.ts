import type { Document } from '../bson';
import { CursorResponse } from '../cmap/wire_protocol/responses';
import type { Collection } from '../collection';
import { type AbstractCursorOptions, type CursorTimeoutMode } from '../cursor/abstract_cursor';
import { MongoCompatibilityError } from '../error';
import { type OneOrMore } from '../mongo_types';
import type { Server } from '../sdam/server';
import type { ClientSession } from '../sessions';
import { type TimeoutContext } from '../timeout';
import { isObject, maxWireVersion, type MongoDBNamespace } from '../utils';
import {
  type CollationOptions,
  CommandOperation,
  type CommandOperationOptions,
  type OperationParent
} from './command';
import { Aspect, defineAspects } from './operation';

const VALID_INDEX_OPTIONS = new Set([
  'background',
  'unique',
  'name',
  'partialFilterExpression',
  'sparse',
  'hidden',
  'expireAfterSeconds',
  'storageEngine',
  'collation',
  'version',

  // text indexes
  'weights',
  'default_language',
  'language_override',
  'textIndexVersion',

  // 2d-sphere indexes
  '2dsphereIndexVersion',

  // 2d indexes
  'bits',
  'min',
  'max',

  // geoHaystack Indexes
  'bucketSize',

  // wildcard indexes
  'wildcardProjection'
]);

/** @public */
export type IndexDirection =
  | -1
  | 1
  | '2d'
  | '2dsphere'
  | 'text'
  | 'geoHaystack'
  | 'hashed'
  | number;

function isIndexDirection(x: unknown): x is IndexDirection {
  return (
    typeof x === 'number' || x === '2d' || x === '2dsphere' || x === 'text' || x === 'geoHaystack'
  );
}
/** @public */
export type IndexSpecification = OneOrMore<
  | string
  | [string, IndexDirection]
  | { [key: string]: IndexDirection }
  | Map<string, IndexDirection>
>;

/** @public */
export interface IndexInformationOptions extends ListIndexesOptions {
  /**
   * When `true`, an array of index descriptions is returned.
   * When `false`, the driver returns an object that with keys corresponding to index names with values
   * corresponding to the entries of the indexes' key.
   *
   * For example, the given the following indexes:
   * ```
   * [ { name: 'a_1', key: { a: 1 } }, { name: 'b_1_c_1' , key: { b: 1, c: 1 } }]
   * ```
   *
   * When `full` is `true`, the above array is returned.  When `full` is `false`, the following is returned:
   * ```
   * {
   *   'a_1': [['a', 1]],
   *   'b_1_c_1': [['b', 1], ['c', 1]],
   * }
   * ```
   */
  full?: boolean;
}

/** @public */
export interface IndexDescription
  extends Pick<
    CreateIndexesOptions,
    | 'background'
    | 'unique'
    | 'partialFilterExpression'
    | 'sparse'
    | 'hidden'
    | 'expireAfterSeconds'
    | 'storageEngine'
    | 'version'
    | 'weights'
    | 'default_language'
    | 'language_override'
    | 'textIndexVersion'
    | '2dsphereIndexVersion'
    | 'bits'
    | 'min'
    | 'max'
    | 'bucketSize'
    | 'wildcardProjection'
  > {
  collation?: CollationOptions;
  name?: string;
  key: { [key: string]: IndexDirection } | Map<string, IndexDirection>;
}

/** @public */
export interface CreateIndexesOptions extends Omit<CommandOperationOptions, 'writeConcern'> {
  /** Creates the index in the background, yielding whenever possible. */
  background?: boolean;
  /** Creates an unique index. */
  unique?: boolean;
  /** Override the autogenerated index name (useful if the resulting name is larger than 128 bytes) */
  name?: string;
  /** Creates a partial index based on the given filter object (MongoDB 3.2 or higher) */
  partialFilterExpression?: Document;
  /** Creates a sparse index. */
  sparse?: boolean;
  /** Allows you to expire data on indexes applied to a data (MongoDB 2.2 or higher) */
  expireAfterSeconds?: number;
  /** Allows users to configure the storage engine on a per-index basis when creating an index. (MongoDB 3.0 or higher) */
  storageEngine?: Document;
  /** (MongoDB 4.4. or higher) Specifies how many data-bearing members of a replica set, including the primary, must complete the index builds successfully before the primary marks the indexes as ready. This option accepts the same values for the "w" field in a write concern plus "votingMembers", which indicates all voting data-bearing nodes. */
  commitQuorum?: number | string;
  /** Specifies the index version number, either 0 or 1. */
  version?: number;
  // text indexes
  weights?: Document;
  default_language?: string;
  language_override?: string;
  textIndexVersion?: number;
  // 2d-sphere indexes
  '2dsphereIndexVersion'?: number;
  // 2d indexes
  bits?: number;
  /** For geospatial indexes set the lower bound for the co-ordinates. */
  min?: number;
  /** For geospatial indexes set the high bound for the co-ordinates. */
  max?: number;
  // geoHaystack Indexes
  bucketSize?: number;
  // wildcard indexes
  wildcardProjection?: Document;
  /** Specifies that the index should exist on the target collection but should not be used by the query planner when executing operations. (MongoDB 4.4 or higher) */
  hidden?: boolean;
}

function isSingleIndexTuple(t: unknown): t is [string, IndexDirection] {
  return Array.isArray(t) && t.length === 2 && isIndexDirection(t[1]);
}

/**
 * Converts an `IndexSpecification`, which can be specified in multiple formats, into a
 * valid `key` for the createIndexes command.
 */
function constructIndexDescriptionMap(indexSpec: IndexSpecification): Map<string, IndexDirection> {
  const key: Map<string, IndexDirection> = new Map();

  const indexSpecs =
    !Array.isArray(indexSpec) || isSingleIndexTuple(indexSpec) ? [indexSpec] : indexSpec;

  // Iterate through array and handle different types
  for (const spec of indexSpecs) {
    if (typeof spec === 'string') {
      key.set(spec, 1);
    } else if (Array.isArray(spec)) {
      key.set(spec[0], spec[1] ?? 1);
    } else if (spec instanceof Map) {
      for (const [property, value] of spec) {
        key.set(property, value);
      }
    } else if (isObject(spec)) {
      for (const [property, value] of Object.entries(spec)) {
        key.set(property, value);
      }
    }
  }

  return key;
}

/**
 * Receives an index description and returns a modified index description which has had invalid options removed
 * from the description and has mapped the `version` option to the `v` option.
 */
function resolveIndexDescription(
  description: IndexDescription
): Omit<ResolvedIndexDescription, 'key'> {
  const validProvidedOptions = Object.entries(description).filter(([optionName]) =>
    VALID_INDEX_OPTIONS.has(optionName)
  );

  return Object.fromEntries(
    // we support the `version` option, but the `createIndexes` command expects it to be the `v`
    validProvidedOptions.map(([name, value]) => (name === 'version' ? ['v', value] : [name, value]))
  );
}

/**
 * @public
 * The index information returned by the listIndexes command. https://www.mongodb.com/docs/manual/reference/command/listIndexes/#mongodb-dbcommand-dbcmd.listIndexes
 */
export type IndexDescriptionInfo = Omit<IndexDescription, 'key' | 'version'> & {
  key: { [key: string]: IndexDirection };
  v?: IndexDescription['version'];
} & Document;

/** @public */
export type IndexDescriptionCompact = Record<string, [name: string, direction: IndexDirection][]>;

/**
 * @internal
 *
 * Internally, the driver represents index description keys with `Map`s to preserve key ordering.
 * We don't require users to specify maps, so we transform user provided descriptions into
 * "resolved" by converting the `key` into a JS `Map`, if it isn't already a map.
 *
 * Additionally, we support the `version` option, but the `createIndexes` command uses the field `v`
 * to specify the index version so we map the value of `version` to `v`, if provided.
 */
type ResolvedIndexDescription = Omit<IndexDescription, 'key' | 'version'> & {
  key: Map<string, IndexDirection>;
  v?: IndexDescription['version'];
};

/** @internal */
export class CreateIndexesOperation extends CommandOperation<string[]> {
  override options: CreateIndexesOptions;
  collectionName: string;
  indexes: ReadonlyArray<ResolvedIndexDescription>;

  private constructor(
    parent: OperationParent,
    collectionName: string,
    indexes: IndexDescription[],
    options?: CreateIndexesOptions
  ) {
    super(parent, options);

    this.options = options ?? {};
    this.collectionName = collectionName;
    this.indexes = indexes.map((userIndex: IndexDescription): ResolvedIndexDescription => {
      // Ensure the key is a Map to preserve index key ordering
      const key =
        userIndex.key instanceof Map ? userIndex.key : new Map(Object.entries(userIndex.key));
      const name = userIndex.name ?? Array.from(key).flat().join('_');
      const validIndexOptions = resolveIndexDescription(userIndex);
      return {
        ...validIndexOptions,
        name,
        key
      };
    });
  }

  static fromIndexDescriptionArray(
    parent: OperationParent,
    collectionName: string,
    indexes: IndexDescription[],
    options?: CreateIndexesOptions
  ): CreateIndexesOperation {
    return new CreateIndexesOperation(parent, collectionName, indexes, options);
  }

  static fromIndexSpecification(
    parent: OperationParent,
    collectionName: string,
    indexSpec: IndexSpecification,
    options: CreateIndexesOptions = {}
  ): CreateIndexesOperation {
    const key = constructIndexDescriptionMap(indexSpec);
    const description: IndexDescription = { ...options, key };
    return new CreateIndexesOperation(parent, collectionName, [description], options);
  }

  override get commandName() {
    return 'createIndexes';
  }

  override async execute(
    server: Server,
    session: ClientSession | undefined,
    timeoutContext: TimeoutContext
  ): Promise<string[]> {
    const options = this.options;
    const indexes = this.indexes;

    const serverWireVersion = maxWireVersion(server);

    const cmd: Document = { createIndexes: this.collectionName, indexes };

    if (options.commitQuorum != null) {
      if (serverWireVersion < 9) {
        throw new MongoCompatibilityError(
          'Option `commitQuorum` for `createIndexes` not supported on servers < 4.4'
        );
      }
      cmd.commitQuorum = options.commitQuorum;
    }

    // collation is set on each index, it should not be defined at the root
    this.options.collation = undefined;

    await super.executeCommand(server, session, cmd, timeoutContext);

    const indexNames = indexes.map(index => index.name || '');
    return indexNames;
  }
}

/** @public */
export type DropIndexesOptions = CommandOperationOptions;

/** @internal */
export class DropIndexOperation extends CommandOperation<Document> {
  override options: DropIndexesOptions;
  collection: Collection;
  indexName: string;

  constructor(collection: Collection, indexName: string, options?: DropIndexesOptions) {
    super(collection, options);

    this.options = options ?? {};
    this.collection = collection;
    this.indexName = indexName;
  }

  override get commandName() {
    return 'dropIndexes' as const;
  }

  override async execute(
    server: Server,
    session: ClientSession | undefined,
    timeoutContext: TimeoutContext
  ): Promise<Document> {
    const cmd = { dropIndexes: this.collection.collectionName, index: this.indexName };
    return await super.executeCommand(server, session, cmd, timeoutContext);
  }
}

/** @public */
export type ListIndexesOptions = AbstractCursorOptions & {
  timeoutMode?: CursorTimeoutMode;
};

/** @internal */
export class ListIndexesOperation extends CommandOperation<CursorResponse> {
  /**
   * @remarks WriteConcern can still be present on the options because
   * we inherit options from the client/db/collection.  The
   * key must be present on the options in order to delete it.
   * This allows typescript to delete the key but will
   * not allow a writeConcern to be assigned as a property on options.
   */
  override options: ListIndexesOptions & { writeConcern?: never };
  collectionNamespace: MongoDBNamespace;

  constructor(collection: Collection, options?: ListIndexesOptions) {
    super(collection, options);

    this.options = { ...options };
    delete this.options.writeConcern;
    this.collectionNamespace = collection.s.namespace;
  }

  override get commandName() {
    return 'listIndexes' as const;
  }

  override async execute(
    server: Server,
    session: ClientSession | undefined,
    timeoutContext: TimeoutContext
  ): Promise<CursorResponse> {
    const serverWireVersion = maxWireVersion(server);

    const cursor = this.options.batchSize ? { batchSize: this.options.batchSize } : {};

    const command: Document = { listIndexes: this.collectionNamespace.collection, cursor };

    // we check for undefined specifically here to allow falsy values
    // eslint-disable-next-line no-restricted-syntax
    if (serverWireVersion >= 9 && this.options.comment !== undefined) {
      command.comment = this.options.comment;
    }

    return await super.executeCommand(server, session, command, timeoutContext, CursorResponse);
  }
}

defineAspects(ListIndexesOperation, [
  Aspect.READ_OPERATION,
  Aspect.RETRYABLE,
  Aspect.CURSOR_CREATING
]);
defineAspects(CreateIndexesOperation, [Aspect.WRITE_OPERATION]);
defineAspects(DropIndexOperation, [Aspect.WRITE_OPERATION]);
