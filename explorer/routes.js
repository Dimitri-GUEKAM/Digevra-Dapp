const EXPLORER_ROUTES = Object.freeze({
  home: '/',
  blocks: '/blocks',
  transactions: '/transactions',
  block: '/block',
  transaction: '/transaction',
  address: '/address'
});

const PATH_ROUTE_SEGMENTS = Object.freeze({
  block: 'block',
  transaction: 'tx',
  address: 'address'
});

export function getExplorerBaseUrl(configuredUrl) {
  const runtimeUrl = globalThis.DIGEVRA_EXPLORER_URL;
  return typeof runtimeUrl === 'string' && runtimeUrl.trim()
    ? runtimeUrl.trim()
    : configuredUrl;
}

export function explorerRoutePath(route, identifier) {
  const basePath = EXPLORER_ROUTES[route];
  if (!basePath) {
    throw new Error(`Unknown Explorer route: ${route}`);
  }
  if (route === 'home') return basePath;
  return identifier === undefined
    ? basePath
    : `${basePath}/${encodeURIComponent(String(identifier))}`;
}

export function explorerHash(route, identifier) {
  return `#${explorerRoutePath(route, identifier)}`;
}

export function buildExplorerUrl(baseUrl, route, identifier, mode = 'hash') {
  if (!baseUrl) return null;
  const url = new URL(baseUrl);
  if (mode === 'hash') {
    url.hash = explorerRoutePath(route, identifier);
    return url.toString();
  }
  if (mode !== 'path') {
    throw new Error(`Unknown Explorer route mode: ${mode}`);
  }
  if (route === 'home') return url.toString();

  const pathSegment = PATH_ROUTE_SEGMENTS[route];
  if (!pathSegment || identifier === undefined) {
    throw new Error(`Route ${route} requires an identifier in path mode.`);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${pathSegment}/${encodeURIComponent(String(identifier))}`;
  return url.toString();
}
