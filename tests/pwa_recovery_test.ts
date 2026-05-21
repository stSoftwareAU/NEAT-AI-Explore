/**
 * Tests for docs/shared/pwa_recovery.js (Issue #194).
 *
 * The PWA recovery helper turns the previous "please clear your browser
 * cache and reload" dead-end (which iOS PWA users cannot action) into an
 * automatic self-heal: clear caches, unregister service workers, then
 * reload. A session-storage flag prevents an infinite recovery loop.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  clearAllCaches,
  clearRecoveryFlag,
  markRecoveryAttempted,
  recoverFromFailedAppLoad,
  shouldAttemptRecovery,
  unregisterAllServiceWorkers,
} from "../docs/shared/pwa_recovery.js";

function fakeStorage(): Storage & { _data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    _data: data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage & { _data: Map<string, string> };
}

interface FakeCache {
  keys(): Promise<string[]>;
  delete(key: string): Promise<boolean>;
  deletedKeys: string[];
}

function fakeCaches(initialKeys: string[]): FakeCache {
  const keys = [...initialKeys];
  const deletedKeys: string[] = [];
  return {
    keys: () => Promise.resolve([...keys]),
    delete: (key: string) => {
      deletedKeys.push(key);
      const idx = keys.indexOf(key);
      if (idx >= 0) keys.splice(idx, 1);
      return Promise.resolve(true);
    },
    deletedKeys,
  };
}

interface FakeRegistration {
  unregister(): Promise<boolean>;
  unregistered: boolean;
}

function fakeRegistration(): FakeRegistration {
  const reg: FakeRegistration = {
    unregistered: false,
    unregister: () => {
      reg.unregistered = true;
      return Promise.resolve(true);
    },
  };
  return reg;
}

interface FakeSwContainer {
  getRegistrations(): Promise<FakeRegistration[]>;
}

function fakeSwContainer(regs: FakeRegistration[]): FakeSwContainer {
  return {
    getRegistrations: () => Promise.resolve(regs),
  };
}

Deno.test("shouldAttemptRecovery returns true when no flag set", () => {
  const storage = fakeStorage();
  assertEquals(shouldAttemptRecovery(storage), true);
});

Deno.test("shouldAttemptRecovery returns false after markRecoveryAttempted", () => {
  const storage = fakeStorage();
  markRecoveryAttempted(storage);
  assertEquals(shouldAttemptRecovery(storage), false);
});

Deno.test("clearRecoveryFlag removes the flag", () => {
  const storage = fakeStorage();
  markRecoveryAttempted(storage);
  clearRecoveryFlag(storage);
  assertEquals(shouldAttemptRecovery(storage), true);
});

Deno.test("shouldAttemptRecovery handles null storage gracefully", () => {
  // Some environments (e.g. private browsing) may not expose storage.
  assertEquals(shouldAttemptRecovery(null), false);
});

Deno.test("shouldAttemptRecovery handles throwing storage gracefully", () => {
  const broken = {
    getItem: () => {
      throw new Error("storage disabled");
    },
  } as unknown as Storage;
  assertEquals(shouldAttemptRecovery(broken), false);
});

Deno.test("markRecoveryAttempted handles throwing storage gracefully", () => {
  const broken = {
    setItem: () => {
      throw new Error("storage disabled");
    },
  } as unknown as Storage;
  // Should not throw.
  markRecoveryAttempted(broken);
});

Deno.test("clearAllCaches deletes every cache key", async () => {
  const caches = fakeCaches(["v1-static", "v1-runtime", "snapshots"]);
  // deno-lint-ignore no-explicit-any
  const deleted = await clearAllCaches(caches as any);
  assertEquals(deleted.length, 3);
  assert(deleted.includes("v1-static"));
  assert(deleted.includes("v1-runtime"));
  assert(deleted.includes("snapshots"));
  assertEquals(caches.deletedKeys.length, 3);
});

Deno.test("clearAllCaches with no caches API returns empty list", async () => {
  const deleted = await clearAllCaches(null);
  assertEquals(deleted.length, 0);
});

Deno.test("unregisterAllServiceWorkers unregisters every registration", async () => {
  const r1 = fakeRegistration();
  const r2 = fakeRegistration();
  const container = fakeSwContainer([r1, r2]);
  const count = await unregisterAllServiceWorkers(container);
  assertEquals(count, 2);
  assert(r1.unregistered);
  assert(r2.unregistered);
});

Deno.test("unregisterAllServiceWorkers handles missing container", async () => {
  const count = await unregisterAllServiceWorkers(null);
  assertEquals(count, 0);
});

Deno.test("recoverFromFailedAppLoad clears caches, unregisters SW, reloads", async () => {
  const storage = fakeStorage();
  const caches = fakeCaches(["v1-static", "snapshots"]);
  const reg = fakeRegistration();
  const swContainer = fakeSwContainer([reg]);
  let reloaded = false;

  const result = await recoverFromFailedAppLoad({
    storage,
    // deno-lint-ignore no-explicit-any
    cachesApi: caches as any,
    swContainer,
    reload: () => {
      reloaded = true;
    },
  });

  assertEquals(result.recovered, true);
  assertEquals(result.reason, "cleared-and-reloaded");
  assertEquals(caches.deletedKeys.length, 2);
  assert(reg.unregistered);
  assert(reloaded, "reload should have been invoked");
  // Flag must be set so a retry doesn't loop.
  assertEquals(shouldAttemptRecovery(storage), false);
});

Deno.test("recoverFromFailedAppLoad refuses second attempt", async () => {
  const storage = fakeStorage();
  markRecoveryAttempted(storage);
  const caches = fakeCaches(["v1-static"]);
  const reg = fakeRegistration();
  const swContainer = fakeSwContainer([reg]);
  let reloaded = false;

  const result = await recoverFromFailedAppLoad({
    storage,
    // deno-lint-ignore no-explicit-any
    cachesApi: caches as any,
    swContainer,
    reload: () => {
      reloaded = true;
    },
  });

  assertEquals(result.recovered, false);
  assertEquals(result.reason, "already-attempted");
  assertEquals(caches.deletedKeys.length, 0);
  assertEquals(reg.unregistered, false);
  assertEquals(reloaded, false);
});

Deno.test("recoverFromFailedAppLoad with no storage still refuses (cannot guard against loop)", async () => {
  const caches = fakeCaches(["v1-static"]);
  const swContainer = fakeSwContainer([fakeRegistration()]);
  let reloaded = false;

  const result = await recoverFromFailedAppLoad({
    storage: null,
    // deno-lint-ignore no-explicit-any
    cachesApi: caches as any,
    swContainer,
    reload: () => {
      reloaded = true;
    },
  });

  // Without storage we cannot detect loops, so we refuse to attempt
  // recovery — otherwise we'd cause an infinite reload spiral.
  assertEquals(result.recovered, false);
  assertEquals(caches.deletedKeys.length, 0);
  assertEquals(reloaded, false);
});
