// Remote Camera v0.3 — resilient VDO.Ninja SDK loader
// Tries multiple official/public endpoints because mobile Safari or a CDN can occasionally fail.
(() => {
  const SOURCES = [
    'https://sdk.vdo.ninja/vdoninja-sdk.min.js',
    'https://unpkg.com/@vdoninja/sdk@1.5.5/vdoninja-sdk.min.js',
    'https://cdn.jsdelivr.net/npm/@vdoninja/sdk@1.5.5/vdoninja-sdk.min.js'
  ];
  let loadingPromise = null;

  function sdkReady() {
    return typeof window.VDONinjaSDK === 'function';
  }

  function loadScript(src, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      if (sdkReady()) return resolve(window.VDONinjaSDK);
      const s = document.createElement('script');
      let done = false;
      const finish = (ok, err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!ok) s.remove();
        ok ? resolve(window.VDONinjaSDK) : reject(err || new Error(`โหลด SDK ไม่สำเร็จ: ${src}`));
      };
      const timer = setTimeout(() => finish(false, new Error(`SDK timeout: ${src}`)), timeoutMs);
      s.src = src;
      s.async = true;
      s.onload = () => sdkReady()
        ? finish(true)
        : finish(false, new Error(`โหลดไฟล์ได้ แต่ไม่พบ VDONinjaSDK: ${src}`));
      s.onerror = () => finish(false, new Error(`โหลด SDK ไม่สำเร็จ: ${src}`));
      document.head.appendChild(s);
    });
  }

  window.loadVDONinjaSDK = function loadVDONinjaSDK(onTry) {
    if (sdkReady()) return Promise.resolve(window.VDONinjaSDK);
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      const errors = [];
      for (let i = 0; i < SOURCES.length; i++) {
        const src = SOURCES[i];
        try {
          if (typeof onTry === 'function') onTry({ index: i + 1, total: SOURCES.length, src });
          await loadScript(src);
          return window.VDONinjaSDK;
        } catch (e) {
          errors.push(e.message || String(e));
        }
      }
      loadingPromise = null;
      throw new Error('ไม่สามารถโหลด VDO.Ninja SDK ได้จากทุกแหล่ง | ' + errors.join(' | '));
    })();
    return loadingPromise;
  };
})();
