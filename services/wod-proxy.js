const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

/**
 * Create Express middleware that reverse-proxies requests to WodScreen,
 * stripping iframe-blocking headers and injecting session cookies.
 *
 * @param {Function} getCookiesFn - Returns cookie string from WodScraper, or null
 * @returns {Function} Express middleware
 */
function createWodProxy(getCookiesFn) {
  return createProxyMiddleware({
    target: 'https://wodscreen.com',
    changeOrigin: true,
    selfHandleResponse: true,
    pathRewrite: { '^/wod-proxy': '' },
    on: {
      proxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
        // Strip iframe-blocking headers
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];

        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let body = buffer.toString('utf8');
          // Inject base href so relative URLs resolve against WodScreen origin
          body = body.replace('<head>', '<head><base href="https://wodscreen.com/">');
          return body;
        }
        return buffer;
      }),
      proxyReq: (proxyReq, req, res) => {
        // Set Host header to WodScreen
        proxyReq.setHeader('Host', 'wodscreen.com');

        // Inject session cookies from WodScraper
        const cookies = getCookiesFn();
        if (cookies) {
          proxyReq.setHeader('Cookie', cookies);
        }
      },
      error: (err, req, res) => {
        console.error(`[WodProxy] Proxy error: ${err.message}`);
        if (res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'WodScreen proxy error', message: err.message }));
        }
      },
    },
  });
}

module.exports = { createWodProxy };
