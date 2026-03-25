/**
 * Type 2: Detect overlapping text (layout regression — text overlapping other text/elements).
 * Type 3: Detect hidden text or overlapping text (verify no overlapping/hidden text).
 * Runs in the browser via evaluate() to use getBoundingClientRect and computed styles.
 */

import type { BrowserApi } from './browser';

export interface TextRect {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  selector?: string;
}

export interface OverlappingPair {
  a: TextRect;
  b: TextRect;
}

export interface OverlappingTextResult {
  overlapping: OverlappingPair[];
  allTextRects: TextRect[];
}

export interface HiddenTextItem {
  text: string;
  reason: string;
  selector?: string;
}

export interface HiddenAndOverlappingResult {
  overlapping: OverlappingPair[];
  hidden: HiddenTextItem[];
  allTextRects: TextRect[];
}

/** In-page script: collect visible text elements and their rects, then find overlaps. */
const GET_OVERLAPPING_SCRIPT = `
(function() {
  function getTextRects() {
    var rects = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.textContent.trim();
      if (text.length === 0) continue;
      var parent = node.parentElement;
      if (!parent || parent.closest('script') || parent.closest('style') || parent.closest('noscript')) continue;
      var style = window.getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.01) continue;
      var r = parent.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      var sel = null;
      try {
        if (parent.id) sel = '#' + CSS.escape(parent.id);
        else if (parent.className && typeof parent.className === 'string') sel = parent.tagName.toLowerCase() + '.' + parent.className.trim().split(/\\s+/)[0];
      } catch (e) {}
      rects.push({ text: text.slice(0, 80), left: r.left, top: r.top, width: r.width, height: r.height, selector: sel });
    }
    return rects;
  }
  function overlaps(a, b) {
    return !(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top);
  }
  var rects = getTextRects();
  var overlapping = [];
  for (var i = 0; i < rects.length; i++) {
    for (var j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i], rects[j])) overlapping.push({ a: rects[i], b: rects[j] });
    }
  }
  return { overlapping: overlapping, allTextRects: rects };
})()
`;

/** In-page script: find hidden text and overlapping text (Type 3). */
const GET_HIDDEN_AND_OVERLAPPING_SCRIPT = `
(function() {
  function getTextRects(includeHidden) {
    var rects = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.textContent.trim();
      if (text.length === 0) continue;
      var parent = node.parentElement;
      if (!parent || parent.closest('script') || parent.closest('style') || parent.closest('noscript')) continue;
      var style = window.getComputedStyle(parent);
      var hidden = false;
      var reason = '';
      if (style.visibility === 'hidden') { hidden = true; reason = 'visibility:hidden'; }
      else if (style.display === 'none') { hidden = true; reason = 'display:none'; }
      else if (parseFloat(style.opacity) < 0.01) { hidden = true; reason = 'opacity near 0'; }
      else if (style.fontSize === '0px' || style.fontSize === '0') { hidden = true; reason = 'font-size:0'; }
      else if (style.overflow === 'hidden' && parent.scrollHeight > parent.clientHeight) { hidden = true; reason = 'overflow:hidden with clipped text'; }
      if (hidden && !includeHidden) continue;
      var r = parent.getBoundingClientRect();
      var sel = null;
      try {
        if (parent.id) sel = '#' + CSS.escape(parent.id);
      } catch (e) {}
      rects.push({ text: text.slice(0, 80), left: r.left, top: r.top, width: r.width, height: r.height, selector: sel, hidden: hidden, reason: reason });
    }
    return rects;
  }
  function overlaps(a, b) {
    return !(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top);
  }
  var rects = getTextRects(true);
  var overlapping = [];
  var hidden = [];
  for (var i = 0; i < rects.length; i++) {
    if (rects[i].hidden) hidden.push({ text: rects[i].text, reason: rects[i].reason, selector: rects[i].selector });
    for (var j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i], rects[j])) overlapping.push({ a: { text: rects[i].text, left: rects[i].left, top: rects[i].top, width: rects[i].width, height: rects[i].height, selector: rects[i].selector }, b: { text: rects[j].text, left: rects[j].left, top: rects[j].top, width: rects[j].width, height: rects[j].height, selector: rects[j].selector } });
    }
  }
  return { overlapping: overlapping, hidden: hidden, allTextRects: rects.map(function(r) { return { text: r.text, left: r.left, top: r.top, width: r.width, height: r.height, selector: r.selector }; }) };
})()
`;

/**
 * Type 2: Check for overlapping text (different height/width layout — text overlapping other text).
 * Use to verify text is not overlapping (e.g. after layout or font changes).
 *
 * @param page - Browser or frame with evaluate (e.g. createBrowser() instance)
 * @returns Overlapping pairs and all text rects
 */
export async function checkOverlappingText(page: { evaluate<T>(expr: string): Promise<T> }): Promise<OverlappingTextResult> {
  const result = await page.evaluate<OverlappingTextResult>(GET_OVERLAPPING_SCRIPT);
  return result;
}

/**
 * Type 3: Check for hidden text and overlapping text.
 * Does not match text content; verifies no overlapping text or hidden text (e.g. overflow, opacity, visibility).
 *
 * @param page - Browser or frame with evaluate
 * @returns Overlapping pairs, hidden text items, and all text rects
 */
export async function checkHiddenOrOverlappingText(page: { evaluate<T>(expr: string): Promise<T> }): Promise<HiddenAndOverlappingResult> {
  const result = await page.evaluate<HiddenAndOverlappingResult>(GET_HIDDEN_AND_OVERLAPPING_SCRIPT);
  return result;
}
