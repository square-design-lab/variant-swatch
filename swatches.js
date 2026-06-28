(function () {
  /*
    Squarespace — Variant Swatches  v1.2
    Square Design Lab

    Turns one OR MORE variant options into clickable / hoverable swatches —
    on the Store grid and the individual product page. Each configured option
    is wholly a colour-swatch option (hex per value) or an image-swatch option
    (image URL per value). Choosing a swatch swaps the product image to the
    matching variant's Squarespace image (resolved across whatever options are
    currently selected, so multi-option products map correctly).

    No classes / no constructors — a plain IIFE with function declarations.
    Driven by the global window.SDL_SWATCH_CONFIG.

    Data comes from Squarespace's own JSON (?format=json), the same technique
    used by the Collection → List Section Sync plugin.
  */

  /* ------------------------------------------------------------------ */
  /*  CONFIG                                                            */
  /* ------------------------------------------------------------------ */

  const DEFAULTS = {
    // NEW (v1.2): one entry per option that should become swatches.
    //   swatchOptions: [
    //     { option: 'Color', type: 'color', values: { Navy: { hex: '#1b2a4a' }, … } },
    //     { option: 'Size',  type: 'image', values: { Small: { image: 'https://…' }, … } }
    //   ]
    // A value is { hex } for colour swatches or { image } for image swatches.
    // The per-option `type` is informational; appearance is driven per value.
    swatchOptions: null,

    // LEGACY single-option config (still supported):
    swatchOption: 'Color',
    colors: {},

    trigger: 'hover',        // 'hover' | 'click' | 'both'
    shape: 'circle',         // 'circle' | 'rounded' | 'square'
    size: 26,                // swatch diameter in px
    gap: 8,                  // gap between swatches in px
    applyToGrid: true,
    applyToProduct: true,
    hideNativeSelect: true,  // PDP: hide native dropdown(s) for swatch option(s)
    hideGridDropdown: true,  // grid: hide native quick-add dropdown(s)
    showLabel: false,        // PDP: show active value next to the option title
    activeBorderWidth: 2,
    activeBorderColor: '#111111',
    activeRadius: 50
  };

  const CONFIG = Object.assign({}, DEFAULTS, window.SDL_SWATCH_CONFIG || {});

  // Normalise to a list of { option, values } regardless of which schema was
  // supplied. New `swatchOptions` wins; otherwise fall back to the legacy pair.
  function getSwatchOptions() {
    if (Array.isArray(CONFIG.swatchOptions) && CONFIG.swatchOptions.length) {
      return CONFIG.swatchOptions
        .map(function (o) {
          return { option: o.option || o.name, values: o.values || o.colors || {} };
        })
        .filter(function (o) { return o.option; });
    }
    return [{ option: CONFIG.swatchOption, values: CONFIG.colors || {} }];
  }

  const SWATCH_OPTIONS = getSwatchOptions();

  /* ------------------------------------------------------------------ */
  /*  DATA FETCHING                                                     */
  /* ------------------------------------------------------------------ */

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
  /*  VARIANT HELPERS                                                   */
  /* ------------------------------------------------------------------ */

  function getVariants(productLike) {
    if (!productLike) return [];
    const sc = productLike.structuredContent || productLike;
    return sc.variants || productLike.variants || [];
  }

  // Ordered, de-duplicated list of values seen for an option.
  function optionValues(variants, optionName) {
    const seen = [];
    const set = {};
    variants.forEach(function (v) {
      const val = (v.attributes || {})[optionName];
      if (val == null || set[val]) return;
      set[val] = true;
      seen.push(val);
    });
    return seen;
  }

  // Resolve the best-matching variant image for the current selection.
  // `changed` (optional) is the option the user just touched — it must match,
  // so single-option products and the touched option always win.
  function resolveAssetUrl(variants, selected, changed) {
    let best = null;
    let bestScore = -1;
    variants.forEach(function (v) {
      const a = v.attributes || {};
      if (changed && a[changed] !== selected[changed]) return;
      let score = 0;
      Object.keys(selected).forEach(function (k) {
        if (selected[k] != null && a[k] === selected[k]) score++;
      });
      if (score > bestScore) { bestScore = score; best = v; }
    });
    return (best && best.mainImage && best.mainImage.assetUrl) || null;
  }

  // Case-insensitive appearance lookup within an option's value map.
  function valueCfg(values, value) {
    if (!values) return null;
    if (values[value]) return values[value];
    const lower = String(value).toLowerCase();
    const k = Object.keys(values).find(function (x) { return x.toLowerCase() === lower; });
    return k ? values[k] : null;
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

  function makeSwatch(value, values) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sdl-swatch';
    btn.dataset.value = value;
    btn.setAttribute('aria-label', value);
    btn.title = value;

    const cfg = valueCfg(values, value);
    if (cfg && cfg.image) {
      btn.classList.add('sdl-swatch--image');
      btn.style.backgroundImage = 'url("' + cfg.image + '")';
    } else if (cfg && cfg.hex) {
      btn.style.backgroundColor = cfg.hex;
    } else {
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

  // Hide a native control. Some themes set display !important above our class,
  // so force it inline too.
  function hideNative(el) {
    if (!el) return;
    el.classList.add('sdl-native-hidden');
    el.style.setProperty('display', 'none', 'important');
  }

  // Reflect a choice in the native <select> so price / stock / cart stay correct.
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

  function placeGridContainer(tile, container) {
    // Swatches go on their own line under the price. The title/price block is a
    // vertical column, so appending into it drops them beneath the price.
    const titlePrice = tile.querySelector('.product-list-title-price');
    if (titlePrice) titlePrice.appendChild(container);
    else (tile.querySelector('.product-list-item-meta') || tile).appendChild(container);
  }

  function initGrid(products) {
    const tiles = Array.from(document.querySelectorAll('.product-list-item'));
    if (!tiles.length) return;

    const byUrl = {};
    products.forEach(function (p) { if (p.fullUrl) byUrl[p.fullUrl] = p; });

    tiles.forEach(function (tile) {
      if (tile.dataset.sdlSwatch) return;
      const link = tile.querySelector('a[href*="/store/p/"], a.product-list-item-link');
      if (!link) return;
      const href = link.getAttribute('href');
      const product = byUrl[href] ||
        products.find(function (p) { return p.fullUrl && href && p.fullUrl.indexOf(href) > -1; });
      if (!product) return;

      const variants = getVariants(product);
      const seed = {};
      const committed = {};
      let built = false;

      SWATCH_OPTIONS.forEach(function (opt) {
        const values = optionValues(variants, opt.option);
        if (!values.length) return;
        seed[opt.option] = values[0];
      });
      Object.assign(committed, seed);

      SWATCH_OPTIONS.forEach(function (opt) {
        const values = optionValues(variants, opt.option);
        if (!values.length) return;
        built = true;

        const container = makeSwatchContainer();
        container.classList.add('sdl-swatches--grid');

        values.forEach(function (value) {
          const btn = makeSwatch(value, opt.values);

          function apply(commit) {
            const sel = Object.assign({}, committed);
            sel[opt.option] = value;
            const url = resolveAssetUrl(variants, sel, opt.option);
            swapGridImage(tile, url);
            if (commit) {
              setActive(container, btn);
              committed[opt.option] = value;
              tile.dataset.sdlCommitted = '1';
              selectNativeValue(tile, opt.option, value);
            }
          }

          if (hoverEnabled) btn.addEventListener('mouseenter', function () { apply(false); });
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            apply(true);
          });
          container.appendChild(btn);
        });

        if (hoverEnabled) {
          container.addEventListener('mouseleave', function () {
            if (tile.dataset.sdlCommitted) {
              swapGridImage(tile, resolveAssetUrl(variants, committed, null));
            } else {
              revertGridImage(tile);
            }
          });
        }

        placeGridContainer(tile, container);
      });

      if (!built) { tile.dataset.sdlSwatch = 'none'; return; }

      if (CONFIG.hideGridDropdown) {
        SWATCH_OPTIONS.forEach(function (opt) {
          const gridSelect = tile.querySelector(
            '.product-list-item-add-to-cart select[name="variant-option-' + opt.option + '-select"]');
          const wrap = gridSelect && gridSelect.closest('.variant-option');
          if (wrap) hideNative(wrap);
        });
      }

      tile.dataset.sdlSwatch = 'true';
    });
  }

  /* ------------------------------------------------------------------ */
  /*  PRODUCT DETAIL PAGE                                               */
  /* ------------------------------------------------------------------ */

  function assetGuid(url) {
    if (!url) return null;
    const clean = url.replace(/\?.*/, '');
    const m = clean.match(/\/content\/v1\/[^/]+\/([^/]+)\//);
    return m ? m[1] : null;
  }

  function currentSlideSrc() {
    const s = document.querySelector('.product-gallery-slides-item.selected .product-gallery-slides-item-image');
    return s ? (s.getAttribute('data-src') || s.src) : null;
  }

  // Drive the native gallery to the slide matching an asset URL by clicking its
  // thumbnail (lets Squarespace's own controller animate the transition).
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

  function initProduct(product) {
    const detail = document.querySelector('.product-detail');
    if (!detail || detail.dataset.sdlSwatch) return;

    const variants = getVariants(product);
    const committed = {};
    let hasCommitted = false;
    const initialAsset = currentSlideSrc();

    // Seed the selection from the native selects (or first value) so image
    // resolution across multiple options has something to combine with.
    SWATCH_OPTIONS.forEach(function (opt) {
      const sel = document.querySelector('select[name="variant-option-' + opt.option + '-select"]');
      const cur = sel && sel.value && Array.from(sel.options).find(function (o) { return o.value === sel.value && o.textContent.trim(); });
      const values = optionValues(variants, opt.option);
      committed[opt.option] = (cur && cur.textContent.trim()) || values[0];
    });

    let built = false;

    SWATCH_OPTIONS.forEach(function (opt) {
      const select = document.querySelector('select[name="variant-option-' + opt.option + '-select"]');
      if (!select) return;
      const values = optionValues(variants, opt.option);
      if (!values.length) return;
      built = true;

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

      values.forEach(function (value) {
        const btn = makeSwatch(value, opt.values);

        function preview() {
          const probe = Object.assign({}, committed);
          probe[opt.option] = value;
          const url = resolveAssetUrl(variants, probe, opt.option);
          if (url) activateGalleryImage(url);
        }
        function commit() {
          setActive(container, btn);
          committed[opt.option] = value;
          hasCommitted = true;
          selectNativeValue(document, opt.option, value);
          const url = resolveAssetUrl(variants, committed, opt.option);
          if (url) activateGalleryImage(url);
          if (labelEl) labelEl.textContent = value;
        }

        if (hoverEnabled) btn.addEventListener('mouseenter', preview);
        btn.addEventListener('click', function (e) { e.preventDefault(); commit(); });
        container.appendChild(btn);
      });

      if (hoverEnabled) {
        container.addEventListener('mouseleave', function () {
          if (hasCommitted) {
            const url = resolveAssetUrl(variants, committed, null);
            if (url) activateGalleryImage(url);
          } else if (initialAsset) {
            activateGalleryImage(initialAsset);
          }
        });
      }

      // Insert swatches outside Squarespace's dropdown wrapper (it carries the
      // border + chevron) so they sit cleanly under the title, then hide it.
      const dropdownWrap = select.closest('.variant-select-wrapper') || select.parentElement;
      dropdownWrap.parentElement.insertBefore(container, dropdownWrap);
      if (CONFIG.hideNativeSelect) hideNative(dropdownWrap);
    });

    detail.dataset.sdlSwatch = built ? 'true' : 'no-option';
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
    const hasValues = SWATCH_OPTIONS.some(function (o) { return o.values && Object.keys(o.values).length; });
    if (!hasValues) {
      console.warn('SDL Variant Swatches — no swatch values configured.');
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
