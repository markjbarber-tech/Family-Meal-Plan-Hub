# The Weekly Board — Loading Animation Component Spec

Final, approved version of the shared loading component referenced in `weekly-board-defaults-loading-prd.md` (Item 3) and `weekly-board-design-system.md` (Motion section). This replaces the earlier single-pulse description in those docs with the actual finished design below.

## What it is

A two-stage looping animation, cycling continuously for as long as a wait state is shown:

1. **Bar wave** (~2.4s): nine short teal bars bob up and down with a staggered delay, so the motion visibly rolls left to right, like a wave — not just bars pulsing in place.
2. **Cranked gear** (~6.4s): a short-toothed teal gear (styled like a settings icon, not a mechanical cog) rotates a full turn in 8 discrete notches. Each notch isn't a clean snap — it winds back slightly, overshoots past the target, recoils, then settles, so it reads as being turned by hand against resistance rather than spinning freely.

The two stages cross-fade into each other (0.35s opacity transition) and loop indefinitely: bars → gear → bars → gear...

## Where to use it

Per the loading-states PRD, this exact component (both stages, same behavior) is the loading state for:
- Initial weekly plan generation
- Meal regeneration (the "+" button on an empty slot)
- External recipe fetch (both the meal-slot add-recipe feature and the meal-history upload's optional recipe link)
- Sign-in / account creation

**Not used for** pull-to-refresh — that keeps its own lightweight native-style indicator and toast, per the same PRD.

The text label beneath the animation changes per context (e.g. "Generating your plan…", "Finding a new meal…", "Reading that recipe…", "Signing you in…") — the animation itself does not change.

## Reference implementation

This is a working reference build — reuse this CSS/markup/JS pattern as the shared component rather than rebuilding from scratch. Colors reference the design system's locked tokens (`--teal`, `--ink-soft`, etc.) — pull from those variables rather than the hex values shown here, which are only inlined for this standalone reference file.

```html
<div class="loading-stage show-bars" id="loading-stage">
  <div class="loading-bars">
    <div class="bar"></div><div class="bar"></div><div class="bar"></div>
    <div class="bar"></div><div class="bar"></div><div class="bar"></div>
    <div class="bar"></div><div class="bar"></div><div class="bar"></div>
  </div>
  <div class="loading-gear-wrap">
    <svg class="loading-gear" viewBox="0 0 36 36">
      <g fill="var(--teal)">
        <circle cx="18" cy="18" r="8"/>
        <rect x="16" y="3" width="4" height="6" rx="1.5"/>
        <rect x="16" y="27" width="4" height="6" rx="1.5"/>
        <rect x="16" y="3" width="4" height="6" rx="1.5" transform="rotate(45 18 18)"/>
        <rect x="16" y="27" width="4" height="6" rx="1.5" transform="rotate(45 18 18)"/>
        <rect x="16" y="3" width="4" height="6" rx="1.5" transform="rotate(90 18 18)"/>
        <rect x="16" y="27" width="4" height="6" rx="1.5" transform="rotate(90 18 18)"/>
        <rect x="16" y="3" width="4" height="6" rx="1.5" transform="rotate(135 18 18)"/>
        <rect x="16" y="27" width="4" height="6" rx="1.5" transform="rotate(135 18 18)"/>
      </g>
      <circle cx="18" cy="18" r="3.5" fill="var(--glass-strong)"/>
    </svg>
  </div>
</div>
<div class="loading-label" id="loading-label">Generating your plan&hellip;</div>
```

```css
.loading-stage{
  height:44px;
  display:flex;
  align-items:center;
  justify-content:center;
  margin-bottom:16px;
  position:relative;
}
.loading-stage > *{
  position:absolute;
  opacity:0;
  transition:opacity 0.35s ease;
}
.loading-stage.show-bars .loading-bars{opacity:1;}
.loading-stage.show-gear .loading-gear-wrap{opacity:1;}

/* Stage 1: bar wave */
.loading-bars{display:flex;align-items:center;justify-content:center;gap:5px;height:40px;}
.loading-bars .bar{width:5px;border-radius:3px;background:var(--teal);height:10px;}
.loading-stage.show-bars .bar{
  animation-name:loading-bob;
  animation-duration:1.2s;
  animation-timing-function:ease-in-out;
  animation-iteration-count:infinite;
}
/* IMPORTANT: keep animation-delay as its own separate rule (do not fold into
   an animation shorthand on a more specific selector) — a shorthand on a
   higher-specificity rule will silently reset delay to 0 and kill the stagger,
   which is what actually creates the traveling-wave look. */
.loading-bars .bar:nth-child(1){animation-delay:0.00s;}
.loading-bars .bar:nth-child(2){animation-delay:0.10s;}
.loading-bars .bar:nth-child(3){animation-delay:0.20s;}
.loading-bars .bar:nth-child(4){animation-delay:0.30s;}
.loading-bars .bar:nth-child(5){animation-delay:0.40s;}
.loading-bars .bar:nth-child(6){animation-delay:0.50s;}
.loading-bars .bar:nth-child(7){animation-delay:0.60s;}
.loading-bars .bar:nth-child(8){animation-delay:0.70s;}
.loading-bars .bar:nth-child(9){animation-delay:0.80s;}
@keyframes loading-bob{
  0%,100%{height:10px;opacity:0.55;}
  50%{height:36px;opacity:1;}
}

/* Stage 2: cranked gear */
.loading-gear-wrap{width:36px;height:36px;}
.loading-gear{width:100%;height:100%;}
.loading-stage.show-gear .loading-gear{
  animation:loading-cranked-turn 6.4s linear infinite;
  transform-origin:50% 50%;
}
@keyframes loading-cranked-turn{
  0%      { transform:rotate(0deg); }
  5.6%    { transform:rotate(-3deg); }
  7.5%    { transform:rotate(50deg); }
  9.4%    { transform:rotate(42deg); }
  12.5%   { transform:rotate(45deg); }
  18.1%   { transform:rotate(42deg); }
  20%     { transform:rotate(95deg); }
  21.9%   { transform:rotate(87deg); }
  25%     { transform:rotate(90deg); }
  30.6%   { transform:rotate(87deg); }
  32.5%   { transform:rotate(140deg); }
  34.4%   { transform:rotate(132deg); }
  37.5%   { transform:rotate(135deg); }
  43.1%   { transform:rotate(132deg); }
  45%     { transform:rotate(185deg); }
  46.9%   { transform:rotate(177deg); }
  50%     { transform:rotate(180deg); }
  55.6%   { transform:rotate(177deg); }
  57.5%   { transform:rotate(230deg); }
  59.4%   { transform:rotate(222deg); }
  62.5%   { transform:rotate(225deg); }
  68.1%   { transform:rotate(222deg); }
  70%     { transform:rotate(275deg); }
  71.9%   { transform:rotate(267deg); }
  75%     { transform:rotate(270deg); }
  80.6%   { transform:rotate(267deg); }
  82.5%   { transform:rotate(320deg); }
  84.4%   { transform:rotate(312deg); }
  87.5%   { transform:rotate(315deg); }
  93.1%   { transform:rotate(312deg); }
  95%     { transform:rotate(365deg); }
  96.9%   { transform:rotate(357deg); }
  100%    { transform:rotate(360deg); }
}

/* Reduced motion: static dot, no animation, no stage switching */
@media (prefers-reduced-motion:reduce){
  .loading-stage{height:auto;position:static;display:block;}
  .loading-stage > *{position:static;opacity:1 !important;transition:none;}
  .loading-bars, .loading-gear-wrap{display:none;}
  .loading-stage::before{content:"";display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--teal);}
  .loading-bars .bar, .loading-gear{animation:none !important;}
}

.loading-label{font-size:0.85rem;color:var(--ink-soft);text-align:center;}
```

```js
// Drives the stage cross-fade. BAR_MS/GEAR_MS must match the CSS animation
// durations above (1.2s bar cycle × 2 ≈ bars stage length; 6.4s = one full
// gear rotation). LABEL_TEXT should be set per call site before invoking this.
function startLoadingAnimation(stageEl, labelEl, labelText){
  labelEl.textContent = labelText;
  const BAR_MS = 2400;
  const GEAR_MS = 6400;
  let cancelled = false;
  function loop(){
    if (cancelled) return;
    stageEl.classList.remove('show-gear');
    stageEl.classList.add('show-bars');
    setTimeout(() => {
      if (cancelled) return;
      stageEl.classList.remove('show-bars');
      stageEl.classList.add('show-gear');
      setTimeout(loop, GEAR_MS);
    }, BAR_MS);
  }
  loop();
  return () => { cancelled = true; }; // call this to stop the loop when the wait ends
}
```

## Notes for implementation
- Build this as one shared component (not copy-pasted per feature) so future timing/visual tweaks only need to happen in one place.
- The `startLoadingAnimation` function returns a cancel handle — call it when the underlying request finishes, rather than leaving the animation running invisibly.
- Colors must reference the design system's CSS variables, not the hardcoded hex values shown in this reference snippet.
