const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

/**
 * Create Express middleware that reverse-proxies requests to WodScreen,
 * stripping iframe-blocking headers, injecting session cookies and localStorage.
 *
 * @param {Function} getCookiesFn - Returns cookie string from WodScraper, or null
 * @param {Function} getLocalStorageFn - Returns localStorage data from WodScraper
 * @returns {Function} Express middleware
 */
function createWodProxy(getCookiesFn, getLocalStorageFn) {
  return createProxyMiddleware({
    target: 'https://www.wodscreen.com',
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

          // Build localStorage injection script
          const storageData = getLocalStorageFn ? getLocalStorageFn() : {};
          const storageEntries = Object.entries(storageData);
          let storageScript = '';
          if (storageEntries.length > 0) {
            const setters = storageEntries
              .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`)
              .join('');
            storageScript = `<script>(function(){try{${setters}}catch(e){}})()</script>`;
          }

          // Auto-navigation script: dismiss Authorize modal and select Daily WOD
          const autoNavScript = `<script>(function(){
            var maxWait=15000,start=Date.now();
            function tryNav(){
              if(Date.now()-start>maxWait)return;
              // First: dismiss Authorize modal by clicking the button
              var authBtn=document.querySelector('[role="dialog"] button, .MuiDialog-root button, .modal button');
              if(authBtn&&/authorize/i.test(authBtn.textContent)){
                // Don't click authorize (it redirects to btwb) — instead close the dialog
                var dialog=authBtn.closest('[role="dialog"]')||authBtn.closest('.MuiDialog-root')||authBtn.closest('.modal');
                if(dialog)dialog.remove();
                // Also remove any backdrop
                var backdrops=document.querySelectorAll('[class*="backdrop"],[class*="Backdrop"],[class*="overlay"]');
                backdrops.forEach(function(b){b.remove();});
              }
              // Then: click "Daily WOD" screen option
              var items=document.querySelectorAll('li button, [role="button"], a');
              for(var i=0;i<items.length;i++){
                var text=(items[i].textContent||'').toLowerCase();
                var parentText=(items[i].parentElement&&items[i].parentElement.textContent||'').toLowerCase();
                if(text.includes('daily wod')||parentText.includes('daily wod')){
                  if(items[i].tagName==='BUTTON'||items[i].getAttribute('role')==='button'){
                    items[i].click();
                    return;
                  }
                }
              }
              // Also try clicking the first list item's button (Daily WOD is first)
              var firstBtn=document.querySelector('ul li:first-child button');
              if(firstBtn){firstBtn.click();return;}
              setTimeout(tryNav,500);
            }
            // Wait for React to mount
            if(document.readyState==='loading'){
              document.addEventListener('DOMContentLoaded',function(){setTimeout(tryNav,1000);});
            }else{
              setTimeout(tryNav,1000);
            }
          })()</script>`;

          // Inject base href, localStorage, and auto-nav BEFORE any other scripts run
          body = body.replace('<head>',
            '<head><base href="https://www.wodscreen.com/">' + storageScript + autoNavScript);
          return body;
        }
        if (contentType.includes('text/css')) {
          let css = buffer.toString('utf8');
          // Rewrite relative url() references in CSS to absolute WodScreen URLs
          css = css.replace(/url\(\s*['"]?(?!data:|https?:|\/\/)(\/?)([^'")]+)['"]?\s*\)/g,
            (match, leadingSlash, urlPath) => {
              return `url("https://www.wodscreen.com/${urlPath}")`;
            });
          return css;
        }
        return buffer;
      }),
      proxyReq: (proxyReq, req, res) => {
        // Set Host header to WodScreen
        proxyReq.setHeader('Host', 'www.wodscreen.com');

        // Set Referer so CDN resources load properly
        proxyReq.setHeader('Referer', 'https://www.wodscreen.com/');

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
