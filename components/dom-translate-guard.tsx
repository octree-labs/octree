'use client';

import { useEffect } from 'react';

/**
 * Chrome's built-in page translation (and Google Translate) replaces the text
 * nodes React rendered with `<font>` wrappers. When React later reconciles
 * that subtree it calls `removeChild` / `insertBefore` with nodes that are no
 * longer children of the parent it remembers, and the DOM throws
 * `NotFoundError: Failed to execute 'removeChild' on 'Node'`, which unmounts
 * the page (facebook/react#11538). It took down /onboarding for a sign-up
 * reading the app in Spanish.
 *
 * The standard workaround from that issue: make both methods tolerate a
 * node that is not a child (warn once, skip the operation) instead of
 * throwing. The app stays translatable; nothing gets `translate="no"`.
 */

const GUARD_FLAG = '__octreeDomTranslateGuard';

type GuardedWindow = Window & { [GUARD_FLAG]?: boolean };

/** Patches Node.prototype once per window. A no-op on the server and on re-install (HMR, re-mount). */
export function installDomTranslateGuard(): void {
  if (typeof window === 'undefined' || typeof Node !== 'function') return;
  const win = window as GuardedWindow;
  if (win[GUARD_FLAG]) return;
  win[GUARD_FLAG] = true;

  let warnedRemove = false;
  let warnedInsert = false;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      if (!warnedRemove) {
        warnedRemove = true;
        console.warn(
          '[dom-translate-guard] removeChild of a node that is not a child (page translation likely rewrote the DOM); skipped',
          child,
          this
        );
      }
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function insertBefore<T extends Node>(this: Node, newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (!warnedInsert) {
        warnedInsert = true;
        console.warn(
          '[dom-translate-guard] insertBefore with a reference node that is not a child (page translation likely rewrote the DOM); skipped',
          referenceNode,
          this
        );
      }
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

// Install as soon as the client bundle loads, before React's first commit.
installDomTranslateGuard();

/** Mounted once in app/layout.tsx; renders nothing. */
export function DomTranslateGuard() {
  useEffect(() => {
    installDomTranslateGuard();
  }, []);
  return null;
}
