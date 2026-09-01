/**
 * Wrap ONE deeply-nested method on a client without mutating it.
 *
 * `withOpenAI(client)` has to intercept `client.chat.completions.create` and
 * leave the other ~200 methods untouched, on a client the caller may also be
 * using unwrapped elsewhere. Monkey-patching the original is out (it is not
 * ours to modify, and it is not reversible); reconstructing the client is out
 * (we would have to know its constructor). A proxy chain along one path is
 * the remaining option.
 *
 * THE PRIVATE-FIELD TRAP, which is why every function here is bound.
 *
 * Modern provider SDKs use real `#private` class fields. Those are keyed to
 * the instance, not looked up on the prototype chain, so a method invoked
 * with `this` set to a PROXY throws `TypeError: Cannot read private member`.
 * Returning methods unbound (or passing the proxy as the Reflect.get
 * receiver) does exactly that. Every function is therefore bound to its real
 * owner before it leaves this file, and `Reflect.get` is called WITHOUT a
 * receiver argument for the same reason.
 */
export function proxyPath<T extends object>(
  target: T,
  path: string[],
  wrapFn: (original: (...args: any[]) => any) => (...args: any[]) => any,
): T {
  if (path.length === 0) return target
  const [head, ...rest] = path

  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop)

      if (prop !== head) {
        return typeof value === 'function' ? value.bind(obj) : value
      }

      if (rest.length === 0) {
        if (typeof value !== 'function') return value
        return wrapFn(value.bind(obj))
      }

      if (value == null || typeof value !== 'object') return value
      return proxyPath(value as object, rest, wrapFn)
    },
  }) as T
}

/** True when `path` resolves to a function on `obj`. Used for shape detection. */
export function hasMethodAt(obj: unknown, path: string[]): boolean {
  let cursor: any = obj
  for (const segment of path) {
    if (cursor == null || (typeof cursor !== 'object' && typeof cursor !== 'function')) return false
    cursor = cursor[segment]
  }
  return typeof cursor === 'function'
}
