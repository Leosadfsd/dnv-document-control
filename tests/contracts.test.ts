import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_VERSION,
  DATABASE_NAME,
  DATABASE_VERSION,
  MAX_FILE_BYTES,
} from '../src/domain/contracts';
import type {
  DrawingCatalogV1,
  DnvBackupV1,
  DnvRepository,
  DnvModuleProps,
  DnvCoreV1,
} from '../src/domain/contracts';

test('independent namespace, size limit and version contract', () => {
  assert.equal(DATABASE_NAME, 'dnv-drawing-tool');
  assert.equal(DATABASE_VERSION, 1);
  assert.equal(CONTRACT_VERSION, 1);
  assert.equal(MAX_FILE_BYTES, 20 * 1024 * 1024);
});

// Compile-time exchange contract checks belong to the integration boundary, not mock implementations.
type Assert<T extends true> = T;
type ExpectedCatalogKeys = 'format' | 'schemaVersion' | 'projectKey' | 'source' | 'drawings';
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type CatalogContract = Assert<Equal<keyof DrawingCatalogV1, ExpectedCatalogKeys>>;
type BackupContract = Assert<Equal<DnvBackupV1['format'], 'dnv-tool-backup'>>;
type ModuleContract = Assert<Equal<keyof DnvModuleProps, 'projectKey' | 'catalog' | 'repository'>>;
type CoreContract = Assert<
  Equal<
    keyof DnvCoreV1,
    | 'parseCatalog'
    | 'parseDocuments'
    | 'parseComments'
    | 'buildDrawingSummaries'
    | 'compareDocuments'
    | 'compareComments'
  >
>;
type RepositoryContract = Assert<
  Equal<
    keyof DnvRepository,
    | 'loadCatalog'
    | 'saveCatalog'
    | 'loadDocuments'
    | 'saveDocuments'
    | 'loadComments'
    | 'saveComments'
    | 'loadThread'
    | 'exportBackup'
    | 'restoreBackup'
    | 'undo'
  >
>;
export type FrozenContracts =
  | CatalogContract
  | BackupContract
  | ModuleContract
  | CoreContract
  | RepositoryContract;
