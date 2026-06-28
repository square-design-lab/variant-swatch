(function () {
  /*
    Squarespace — Variant Swatches  v1.0
    Square Design Lab

    Turns a single chosen variant option (e.g. "Color") into clickable /
    hoverable swatches — both on the Store grid and on the individual
    product page. Choosing a swatch swaps the product image to that
    variant's Squarespace image.

    No classes / no constructors — a plain IIFE with function declarations.
    All behaviour is driven by the optional global window.SDL_SWATCH_CONFIG.

    Data comes from Squarespace's own JSON (?format=json), the same
    technique used by the Collection → List Section Sync plugin.
  */

  /* ------------------------------------------------------------------ */
  /*  CONFIG                                                            */
  /* ------------------------------------------------------------------ */

  const DEFAULTS = {
    swatchOption: 'Color',   // which variant option becomes swatches
    trigger: 'hover',        // 'hover' | 'click' | 'both'  (hover always also commits on click)
    shape: 'circle',         // 'circle' | 'rounded' | 'square'
    size: 26,                // swatch diameter in px
    gap: 8,                  // space between swatches in px
    applyToGrid: true,       // show swatches on the store/category grid
    applyToProduct: true,    // show swatches on the product detail page
    hideNativeSelect: true,  // PDP: hide the native dropdown for the swatch option
    hideGridDropdown: true,  // grid: hide the native quick-add dropdown for the swatch option
    showLabel: false,        // PDP: show the active value next to the option title
    activeBorderWidth: 2,    // active swatch ring thickness in px
    activeBorderColor: '#111111', // active swatch ring colour
    activeRadius: 50,        // active swatch corner radius in px (high = pill/circle, 0 = square)
    colors: {}               // REQUIRED: { Navy: {hex:'#1b2a4a'} | {image:'https://…'} , … }
  };

  const CONFIG = Object.assign({}, DEFAULTS, window.SDL_SWATCH_CONFIG || {});

  /* ------------------------------------------------------------------ */
  /*  DATA FETCHING                                                     */
  /* ------------------------------------------------------------------ */

  // Fetch Squarespace JSON for a path, forcing format=json + cache-bust.
  async function getJSON(path) {
    const url = new URL(path, window.location.origin);
    const params = new URLSearchParams(url.search);
    params.set('format', 'json');
    params.set('date', Date.now());
    url.search = params.toString();
    const res = await fetch(url.toString(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!res.ok) throw new Error('SDL Swatches — fetch failed ' + res.status + ' for ' + path);
    return res.json();
  }

  // Walk collection pagination until we have every product (or run out).
  async function getAllCollectionItems(path) {
    const items = [];
    let next = path;
    let guard = 0;
    while (next && guard < 20) {
      const data = await getJSON(next);
      (data.items || []).forEach(function (it) { items.push(it); });
      if (data.pagination && data.pagination.nextPage && data.pagination.nextPageUrl) {
        next = data.pagination.nextPageUrl;
        guard++;
      } else {
        next = null;
      }
    }
    return items;
  }

  /* ------------------------------------------------------------------ */
  /*  VARIANT → SWATCH MODEL                                            */
  /* ------------------------------------------------------------------ */

  function getVariants(productLike) {
    if (!productLike) return [];
    const sc = productLike.structuredContent || productLike;
    return sc.variants || productLike.variants || [];
  }

  function getOrdering(productLike) {
    const sc = (productLike && productLike.structuredContent) || productLike || {};
    return sc.variantOptionOrdering || [];
  }

  // Group variants by the chosen option value -> first image we see for it.
  // Returns an ordered array: [{ value, assetUrl }].
  function buildSwatchModel(variants, optionName) {
    const seen = new Map();
    variants.forEach(function (v) {
      const attrs = v.attributes || {};
      const val = attrs[optionName];
      if (val == null || seen.has(val)) return;
      const assetUrl = (v.mainImage && v.mainImage.assetUrl) || null;
      seen.set(val, assetUrl);
    });
    return Array.from(seen, function (pair) {
      return { value: pair[0], assetUrl: pair[1] };
    });
  }

  // Case-insensitive lookup into CONFIG.colors.
  function colorConfigFor(value) {
    if (CONFIG.colors[value]) return CONFIG.colors[value];
    const lower = String(value).toLowerCase();
    const key = Object.keys(CONFIG.colors).find(function (k) {
      return k.toLowerCase() === lower;
    });
    return key ? CONFIG.colors[key] : null;
  }

  /* ------------------------------------------------------------------ */
  /*  SWATCH ELEMENTS                                                   */
  /* ------------------------------------------------------------------ */

  function makeSwatchContainer() {
    const wrap = document.createElement('div');
    wrap.className = 'sdl-swatches sdl-shape-' + CONFIG.shape;
    wrap.style.setProperty('--sdl-swatch-size', CONFIG.size + 'px');
    wrap.style.setProperty('--sdl-swatch-gap', CONFIG.gap + 'px');
    wrap.style.setProperty('--sdl-active-bw', CONFIG.activeBorderWidth + 'px');
    wrap.style.setProperty('--sdl-active-bc', CONFIG.activeBorderColor);
    wrap.style.setProperty('--sdl-active-radius', CONFIG.activeRadius + 'px');
    return wrap;
  }

  function makeSwatch(entry) {
    const value = entry.value;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sdl-swatch';
    btn.dataset.value = value;
    if (entry.assetUrl) btn.dataset.image = entry.assetUrl;
    btn.setAttribute('aria-label', value);
    btn.title = value;

    const cfg = colorConfigFor(value);
    if (cfg && cfg.image) {
      btn.classList.add('sdl-swatch--image');
      btn.style.backgroundImage = 'url("' + cfg.image + '")';
    } else if (cfg && cfg.hex) {
      btn.style.backgroundColor = cfg.hex;
    } else {
      // Not configured — visible placeholder so the store owner notices.
      btn.classList.add('sdl-swatch--unset');
      btn.textContent = String(value).charAt(0).toUpperCase();
    }
    return btn;
  }

  function setActive(container, btn) {
    container.querySelectorAll('.sdl-swatch.is-active').forEach(function (b) {
      b.classList.remove('is-active');
    });
    if (btn) btn.classList.add('is-active');
  }

  // Hide a native control. Some themes set `display` with !important at a
  // higher specificity than our class, so we also force it inline.
  function hideNative(el) {
    if (!el) return;
    el.classList.add('sdl-native-hidden');
    el.style.setProperty('display', 'none', 'important');
  }

  const hoverEnabled = CONFIG.trigger === 'hover' || CONFIG.trigger === 'both';

  /* ------------------------------------------------------------------ */
  /*  STORE GRID                                                        */
  /* ------------------------------------------------------------------ */

  function gridCoverImg(tile) {
    return tile.querySelector('img.grid-image-cover') ||
           tile.querySelector('img.grid-item-image');
  }

  function swapGridImage(tile, assetUrl) {
    const cover = gridCoverImg(tile);
    if (!cover || !assetUrl) return;
    if (!cover.dataset.sdlOrig) cover.dataset.sdlOrig = cover.currentSrc || cover.src;
    cover.srcset = '';
    cover.src = assetUrl + (assetUrl.indexOf('?') > -1 ? '&' : '?') + 'format=750w';
    tile.classList.add('sdl-swapped');
  }

  function revertGridImage(tile) {
    const cover = gridCoverImg(tile);
    if (cover && cover.dataset.sdlOrig) {
      cover.srcset = '';
      cover.src = cover.dataset.sdlOrig;
    }
    tile.classList.remove('sdl-swapped');
  }

  function initGrid(products) {
    const tiles = Array.from(document.querySelectorAll('.product-list-item'));
    if (!tiles.length) return;

    // Index products by their fullUrl so we can match a tile by its link.
    const byUrl = {};
    products.forEach(function (p) {
      if (p.fullUrl) byUrl[p.fullUrl] = p;
    });

    tiles.forEach(function (tile) {
      if (tile.dataset.sdlSwatch) return;
      const link = tile.querySelector('a[href*="/store/p/"], a.product-list-item-link');
      if (!link) return;
      const href = link.getAttribute('href');
      const product = byUrl[href] ||
        products.find(function (p) { return p.fullUrl && href && p.fullUrl.indexOf(href) > -1; });
      if (!product) return;

      const model = buildSwatchModel(getVariants(product), CONFIG.swatchOption);
      if (model.length < 1) { tile.dataset.sdlSwatch = 'none'; return; }

      const container = makeSwatchContainer();
      container.classList.add('sdl-swatches--grid');

      model.forEach(function (entry) {
        const btn = makeSwatch(entry);

        function commit() {
          setActive(container, btn);
          tile.dataset.sdlCommitted = entry.assetUrl || '';
          swapGridImage(tile, entry.assetUrl);
          // Keep the (hidden) quick-add dropdown in sync so Add to Cart works.
          selectNativeValue(tile, CONFIG.swatchOption, entry.value);
        }

        if (hoverEnabled) {
          btn.addEventListener('mouseenter', function () { swapGridImage(tile, entry.assetUrl); });
        }
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          commit();
        });
        container.appendChild(btn);
      });

      // Restore the committed (or original) image when the pointer leaves.
      if (hoverEnabled) {
        container.addEventListener('mouseleave', function () {
          const committed = tile.dataset.sdlCommitted;
          if (committed) swapGridImage(tile, committed);
          else revertGridImage(tile);
        });
      }

      // Place the swatches on their own line directly under the price. The
      // title/price block is a vertical column, so appending into it drops the
      // swatches beneath the price (rather than beside it in the meta row).
      const titlePrice = tile.querySelector('.product-list-title-price');
      if (titlePrice) {
        titlePrice.appendChild(container);
      } else {
        (tile.querySelector('.product-list-item-meta') || tile).appendChild(container);
      }

      // Hide the native quick-add dropdown for the swatch option — the swatch
      // now drives it. (Other options, e.g. Size, are left untouched.)
      if (CONFIG.hideGridDropdown) {
        const gridSelect = tile.querySelector(
          '.product-list-item-add-to-cart select[name="variant-option-' + CONFIG.swatchOption + '-select"]');
        const gridOptionWrap = gridSelect && gridSelect.closest('.variant-option');
        if (gridOptionWrap) hideNative(gridOptionWrap);
      }

      tile.dataset.sdlSwatch = 'true';
    });
  }

  /* ------------------------------------------------------------------ */
  /*  PRODUCT DETAIL PAGE                                               */
  /* ------------------------------------------------------------------ */

  // The unique image folder id inside a Squarespace asset URL.
  function assetGuid(url) {
    if (!url) return null;
    const clean = url.replace(/\?.*/, '');
    const m = clean.match(/\/content\/v1\/[^/]+\/([^/]+)\//);
    return m ? m[1] : null;
  }

  // Drive the native gallery to the slide matching an asset URL by clicking
  // its thumbnail (lets Squarespace's own controller do the transition).
  function activateGalleryImage(assetUrl) {
    const guid = assetGuid(assetUrl);
    if (!guid) return false;
    const thumbs = Array.from(document.querySelectorAll('.product-gallery-thumbnails-item'));
    const target = thumbs.find(function (b) {
      const im = b.querySelector('img');
      const ds = (im && (im.getAttribute('data-src') || im.src)) || '';
      return ds.indexOf(guid) > -1;
    });
    if (target) { target.click(); return true; }
    return false;
  }

  // Reflect the choice in the native <select> so price / stock / add-to-cart
  // stay correct, then let Squarespace react. `root` scopes the lookup (the
  // tile on the grid, or the document on the product page).
  function selectNativeValue(root, optionName, value) {
    const sel = root.querySelector('select[name="variant-option-' + optionName + '-select"]');
    if (!sel) return;
    const opt = Array.from(sel.options).find(function (o) {
      return o.textContent.trim() === value || o.value === value;
    });
    if (!opt) return;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function initProduct(product) {
    const detail = document.querySelector('.product-detail');
    if (!detail || detail.dataset.sdlSwatch) return;

    const optionName = CONFIG.swatchOption;
    const select = document.querySelector('select[name="variant-option-' + optionName + '-select"]');
    if (!select) { detail.dataset.sdlSwatch = 'no-option'; return; }

    const model = buildSwatchModel(getVariants(product), optionName);
    if (model.length < 1) { detail.dataset.sdlSwatch = 'none'; return; }

    const optionWrap = select.closest('.variant-option') || select.parentElement;
    const container = makeSwatchContainer();
    container.classList.add('sdl-swatches--product');

    let labelEl = null;
    if (CONFIG.showLabel) {
      labelEl = document.createElement('span');
      labelEl.className = 'sdl-swatch-active-label';
      const title = optionWrap.querySelector('.variant-option-title, .title');
      if (title) title.appendChild(labelEl);
    }

    let committedUrl = null;

    model.forEach(function (entry) {
      const btn = makeSwatch(entry);

      function preview() { if (entry.assetUrl) activateGalleryImage(entry.assetUrl); }
      function commit() {
        setActive(container, btn);
        committedUrl = entry.assetUrl || null;
        selectNativeValue(document, optionName, entry.value);
        if (entry.assetUrl) activateGalleryImage(entry.assetUrl);
        if (labelEl) labelEl.textContent = entry.value;
      }

      if (hoverEnabled) {
        btn.addEventListener('mouseenter', preview);
      }
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        commit();
      });
      container.appendChild(btn);
    });

    if (hoverEnabled) {
      container.addEventListener('mouseleave', function () {
        if (committedUrl) activateGalleryImage(committedUrl);
      });
    }

    // Insert the swatches outside Squarespace's dropdown wrapper (which carries
    // the border + chevron) so they sit cleanly under the option title, then
    // hide that entire wrapper.
    const dropdownWrap = select.closest('.variant-select-wrapper') || select.parentElement;
    dropdownWrap.parentElement.insertBefore(container, dropdownWrap);
    if (CONFIG.hideNativeSelect) hideNative(dropdownWrap);

    detail.dataset.sdlSwatch = 'true';
  }

  /* ------------------------------------------------------------------ */
  /*  ORCHESTRATION                                                     */
  /* ------------------------------------------------------------------ */

  let running = false;

  async function run() {
    if (running) return;
    running = true;
    try {
      const onGrid = CONFIG.applyToGrid && document.querySelector('.product-list-item');
      const onProduct = CONFIG.applyToProduct && document.querySelector('.product-detail');

      if (onGrid) {
        const items = await getAllCollectionItems(window.location.pathname);
        initGrid(items);
      }
      if (onProduct) {
        const data = await getJSON(window.location.pathname);
        const product = data.item || data.collection || data;
        initProduct(product);
      }
    } catch (err) {
      console.error('SDL Variant Swatches —', err);
    } finally {
      running = false;
    }
  }

  function init() {
    if (!CONFIG.colors || !Object.keys(CONFIG.colors).length) {
      console.warn('SDL Variant Swatches — no colors configured in SDL_SWATCH_CONFIG.colors.');
    }
    run();
  }

  window.sdlVariantSwatches = { init: init, run: run };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
