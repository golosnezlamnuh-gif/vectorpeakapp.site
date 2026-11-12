/* Cold Open: AdSense slots.
 * The AdSense <script> itself is added to every page <head> by tools/build.mjs when a publisher id is set.
 * This file only fills the labelled .ad-slot containers, and only for slots that have an id in site.config.json.
 * Policy rules baked in: slots are never created on loading/empty/error screens (callers decide),
 * every slot carries an "Advertisement" label, and unfilled slots collapse (see site.css).
 * Open any page with ?adpreview=1 to see where the slots will sit before ads are live. */
(function () {
  'use strict';
  var CFG = (window.CO_CONFIG && window.CO_CONFIG.ads) || {};
  var CLIENT_OK = /^ca-pub-\d{10,20}$/.test(CFG.client || '');
  var PREVIEW = /[?&]adpreview=1(&|$)/.test(location.search);

  function slotId(key) {
    var id = CFG.slots && CFG.slots[key];
    return /^\d{6,20}$/.test(id || '') ? id : '';
  }
  function slotEnabled(key) { return CLIENT_OK && !!slotId(key); }

  function mount(el) {
    if (el.getAttribute('data-ad-ready')) return;
    var key = el.getAttribute('data-ad');
    if (slotEnabled(key)) {
      el.setAttribute('data-ad-ready', '1');
      el.innerHTML = '<p class="ad-label">Advertisement</p><ins class="adsbygoogle" style="display:block" data-ad-client="' +
        CFG.client + '" data-ad-slot="' + slotId(key) + '" data-ad-format="auto" data-full-width-responsive="true"></ins>';
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked or not loaded: slot stays empty and collapses */ }
    } else if (PREVIEW) {
      el.setAttribute('data-ad-ready', '1');
      el.classList.add('is-preview');
      el.innerHTML = '<p class="ad-label">Advertisement</p><p>Ad slot "' + key + '" (preview). A real ad appears here once its AdSense slot id is set.</p>';
    } else {
      el.remove(); // not configured: leave no empty box behind
    }
  }
  function init(root) {
    Array.prototype.slice.call((root || document).querySelectorAll('.ad-slot[data-ad]')).forEach(mount);
  }

  window.CO = window.CO || {};
  window.CO.ads = { init: init, slotEnabled: slotEnabled, preview: PREVIEW };
})();
