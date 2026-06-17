import { describe, it, expect } from "vitest";
import { buildBwrapArgs, sandboxAvailable } from "../src/tools/sandbox.js";

describe("buildBwrapArgs (pure argv builder)", () => {
  const root = "/home/u/proj";

  it("unshares the network by default (no-network posture)", () => {
    const args = buildBwrapArgs({ projectRoot: root });
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--die-with-parent");
  });

  it("bind-mounts the project root read-write", () => {
    const args = buildBwrapArgs({ projectRoot: root });
    const i = args.indexOf("--bind");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe(root);
    expect(args[i + 2]).toBe(root);
  });

  it("read-only-binds the OS core paths (/usr /lib /bin ...)", () => {
    const args = buildBwrapArgs({ projectRoot: root });
    expect(args).toContain("/usr");
    expect(args).toContain("/lib");
    expect(args).toContain("/bin");
    expect(args).toContain("/sbin");
  });

  it("ends in '--' so the caller appends the real command", () => {
    const args = buildBwrapArgs({ projectRoot: root });
    expect(args[args.length - 1]).toBe("--");
  });

  it("chdirs into the project root by default", () => {
    const args = buildBwrapArgs({ projectRoot: root });
    const i = args.indexOf("--chdir");
    expect(args[i + 1]).toBe(root);
  });

  it("honors an explicit cwd", () => {
    const args = buildBwrapArgs({ projectRoot: root, cwd: "/home/u/proj/sub" });
    const i = args.indexOf("--chdir");
    expect(args[i + 1]).toBe("/home/u/proj/sub");
  });

  it("adds extra read-only bind mounts", () => {
    const args = buildBwrapArgs({
      projectRoot: root,
      extraRoBind: ["/home/u/.cache"],
    });
    expect(args).toContain("/home/u/.cache");
    // Extras use --ro-bind-try (ignored if the path is absent on the host).
    const roIdxs: number[] = [];
    args.forEach((a, i) => (a === "--ro-bind" || a === "--ro-bind-try") && roIdxs.push(i));
    expect(roIdxs.some((i) => args[i + 1] === "/home/u/.cache")).toBe(true);
  });

  it("drops the net-namespace unshare when allowNetwork is set (networked posture)", () => {
    const args = buildBwrapArgs({ projectRoot: root, allowNetwork: true });
    expect(args).not.toContain("--unshare-net-keep-proc-uid-gid");
    expect(args).toContain("--bind"); // project root still writable
    expect(args[args.length - 1]).toBe("--");
  });
});

describe("sandboxAvailable", () => {
  it("reports a boolean without throwing", () => {
    expect(typeof sandboxAvailable()).toBe("boolean");
  });
});
