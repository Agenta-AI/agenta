// GitHub star count, read once per build; falls back to the last known count.
const REPO = "Agenta-AI/agenta";
const FALLBACK = 4900;

let cached: Promise<number> | undefined;

export function githubStars(): Promise<number> {
  cached ??= (async () => {
    try {
      const token = import.meta.env.GITHUB_TOKEN as string | undefined;
      const res = await fetch(`https://api.github.com/repos/${REPO}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return FALLBACK;
      const data = (await res.json()) as { stargazers_count?: number };
      return typeof data.stargazers_count === "number" ? data.stargazers_count : FALLBACK;
    } catch {
      return FALLBACK;
    }
  })();
  return cached;
}

// 4906 -> "4.9k", 12345 -> "12.3k", 950 -> "950".
export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
}
