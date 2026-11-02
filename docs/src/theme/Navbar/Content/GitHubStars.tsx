import React, {useEffect, useState, type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import styles from './styles.module.css';

const CACHE_KEY = 'agenta-docs:github-stars';
const CACHE_TTL_MS = 60 * 60 * 1000;

/** "3.1k" style, like GitHub's own counter. */
function formatStars(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
}

/**
 * The star count comes from the GitHub API on the client, cached in
 * sessionStorage for an hour so browsing the docs does not burn the
 * unauthenticated rate limit. Nothing is shown until the number is known.
 */
function useGitHubStars(repo: string): number | null {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const {value, at} = JSON.parse(cached) as {value: number; at: number};
        if (Date.now() - at < CACHE_TTL_MS) {
          setStars(value);
          return;
        }
      }
    } catch {
      // Storage unavailable; fetch every time.
    }

    const controller = new AbortController();
    fetch(`https://api.github.com/repos/${repo}`, {
      headers: {Accept: 'application/vnd.github+json'},
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: {stargazers_count?: number}) => {
        if (typeof data.stargazers_count !== 'number') return;
        setStars(data.stargazers_count);
        try {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({value: data.stargazers_count, at: Date.now()}),
          );
        } catch {
          // Storage unavailable; nothing to do.
        }
      })
      .catch(() => {
        // Rate-limited or offline: the link still works, just without a count.
      });
    return () => controller.abort();
  }, [repo]);

  return stars;
}

/** GitHub link in the header with the live star count. */
export default function GitHubStars(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const repo = siteConfig.customFields?.githubRepo as string | undefined;
  const stars = useGitHubStars(repo ?? '');
  if (!repo) return null;

  return (
    <Link
      href={`https://github.com/${repo}`}
      className={styles.github}
      aria-label={stars === null ? 'GitHub repository' : `GitHub repository, ${stars} stars`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M12 .5A11.5 11.5 0 0 0 .5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
      </svg>
      {stars !== null && <span className={styles.githubCount}>{formatStars(stars)}</span>}
    </Link>
  );
}
