// Polyfill for Promise.withResolvers
// This is needed for compatibility with older Node.js versions

if (!Promise.withResolvers) {
  Promise.withResolvers = function <T>() {
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (reason?: unknown) => void;
    
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    
    return {
      promise,
      resolve: resolve!,
      reject: reject!
    };
  };
}

export {}; 