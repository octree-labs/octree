import { describe, it, expect, vi, afterEach } from 'vitest';

import { installDomTranslateGuard } from '@/components/dom-translate-guard';

describe('installDomTranslateGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is installed on import and idempotent on re-install', () => {
    const removeChild = Node.prototype.removeChild;
    const insertBefore = Node.prototype.insertBefore;
    installDomTranslateGuard();
    installDomTranslateGuard();
    expect(Node.prototype.removeChild).toBe(removeChild);
    expect(Node.prototype.insertBefore).toBe(insertBefore);
    expect((window as any).__octreeDomTranslateGuard).toBe(true);
  });

  it('removeChild of a node that is not a child returns it instead of throwing, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parent = document.createElement('div');
    const detached = document.createElement('span');

    expect(() => parent.removeChild(detached)).not.toThrow();
    expect(parent.removeChild(detached)).toBe(detached);
    // A node moved under a translation <font> wrapper: a grandchild, not a child.
    const font = document.createElement('font');
    const text = document.createTextNode('hola');
    font.appendChild(text);
    parent.appendChild(font);
    expect(parent.removeChild(text)).toBe(text);
    expect(font.firstChild).toBe(text);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('insertBefore with a reference node that is not a child returns the new node instead of throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parent = document.createElement('div');
    const newNode = document.createElement('b');
    const detachedRef = document.createElement('i');

    expect(() => parent.insertBefore(newNode, detachedRef)).not.toThrow();
    expect(parent.insertBefore(newNode, detachedRef)).toBe(newNode);
    expect(parent.childNodes.length).toBe(0);
  });

  it('ordinary removeChild / insertBefore still work', () => {
    const parent = document.createElement('div');
    const a = document.createElement('a');
    const b = document.createElement('b');
    const c = document.createElement('i');

    parent.appendChild(a);
    expect(parent.insertBefore(b, a)).toBe(b);
    expect(Array.from(parent.childNodes)).toEqual([b, a]);
    // A null reference appends, as the DOM specifies.
    parent.insertBefore(c, null);
    expect(Array.from(parent.childNodes)).toEqual([b, a, c]);

    expect(parent.removeChild(a)).toBe(a);
    expect(Array.from(parent.childNodes)).toEqual([b, c]);
    expect(a.parentNode).toBeNull();
  });
});
