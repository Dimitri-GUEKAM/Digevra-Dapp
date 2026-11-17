export type ExplorerRoute =
  | 'home'
  | 'blocks'
  | 'transactions'
  | 'block'
  | 'transaction'
  | 'address';

export type ExplorerRouteMode = 'hash' | 'path';

export function getExplorerBaseUrl(configuredUrl: string | null): string | null;

export function explorerRoutePath(
  route: ExplorerRoute,
  identifier?: string | number
): string;

export function explorerHash(
  route: ExplorerRoute,
  identifier?: string | number
): string;

export function buildExplorerUrl(
  baseUrl: string | null,
  route: ExplorerRoute,
  identifier?: string | number,
  mode?: ExplorerRouteMode
): string | null;
