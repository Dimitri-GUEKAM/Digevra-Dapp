const proxyServer = {
  target: 'http://127.0.0.1:9545',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/besu-rpc/, ''),
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyRequest) => {
      proxyRequest.removeHeader('origin');
    });
  }
};

module.exports = {
  '/besu-rpc': proxyServer,
  '/api': {
    target: 'http://127.0.0.1:3001',
    changeOrigin: true,
    secure: false
  }
};
