import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger({ prefix: "team" });

/**
 * A team manifest: a shared extension registry plus a roster of members
 * (V10 teams). The `registry` URL can double as a `/marketplace` source so a
 * whole team installs the same skills/MCP servers from one place.
 */
export interface TeamManifest {
  name?: string;
  registry?: string;
  members?: string[];
}

/** Default team file: `<homedir>/.config/sentinel/team.json`. */
export function defaultTeamPath(): string {
  return join(homedir(), ".config", "sentinel", "team.json");
}

/**
 * Persisted, testable store for a team manifest.
 *
 * Pure aside from the injected file path: pass a tmp file in tests.
 * Reads never throw (a missing/corrupt file yields an empty manifest);
 * mutations persist immediately via `save()`.
 */
export class TeamStore {
  private filePath: string;
  private team: TeamManifest = {};

  constructor(filePath?: string) {
    this.filePath = filePath || defaultTeamPath();
    this.load();
  }

  /** Load from disk. Tolerates a missing/invalid file → empty manifest. Never throws. */
  load(): TeamManifest {
    if (!existsSync(this.filePath)) {
      this.team = {};
      return this.team;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<TeamManifest>;
      const name = typeof parsed.name === "string" ? parsed.name : undefined;
      const registry = typeof parsed.registry === "string" ? parsed.registry : undefined;
      const members = Array.isArray(parsed.members)
        ? this.dedupe(parsed.members.filter((m): m is string => typeof m === "string"))
        : [];
      this.team = { name, registry, members };
    } catch (err) {
      log.warn(`Failed to read team from ${this.filePath}: ${err}`);
      this.team = {};
    }
    return this.team;
  }

  /** Persist the current manifest to disk, creating the parent dir if needed. */
  save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.team, null, 2), "utf-8");
    } catch (err) {
      log.warn(`Failed to save team to ${this.filePath}: ${err}`);
      throw err;
    }
  }

  /** A snapshot of the current manifest. */
  get(): TeamManifest {
    return {
      name: this.team.name,
      registry: this.team.registry,
      members: this.team.members ? [...this.team.members] : [],
    };
  }

  /** Set the team name. Persists. */
  setName(name: string): void {
    this.team.name = name;
    this.save();
  }

  /** Set the shared registry URL (usable as a /marketplace source). Persists. */
  setRegistry(url: string): void {
    this.team.registry = url;
    this.save();
  }

  /** Add a member id (deduped). Persists. Returns the resolved member id. */
  addMember(id: string): string {
    const member = id.trim();
    if (!this.team.members) this.team.members = [];
    if (!this.team.members.includes(member)) {
      this.team.members.push(member);
      this.save();
    }
    return member;
  }

  /** Remove a member id. Returns true if removed. Persists. */
  removeMember(id: string): boolean {
    const member = id.trim();
    if (!this.team.members) return false;
    const idx = this.team.members.indexOf(member);
    if (idx === -1) return false;
    this.team.members.splice(idx, 1);
    this.save();
    return true;
  }

  /** All members (deduped). */
  listMembers(): string[] {
    return this.team.members ? [...this.team.members] : [];
  }

  private dedupe(members: string[]): string[] {
    return Array.from(new Set(members));
  }
}
