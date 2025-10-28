import React, { useEffect, useMemo, useState } from 'react';
import Layout from '@theme/Layout';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Link from '@docusaurus/Link';
import BrowserOnly from '@docusaurus/BrowserOnly';
import clsx from 'clsx';
import styles from './roadmap.module.css';

import {
    shippedFeatures,
    inProgressFeatures,
    plannedFeatures,
    ShippedFeature,
    PlannedFeature,
    Label,
} from '../data/roadmap';

type GithubDiscussion = {
    id: string;
    title: string;
    url: string;
    comments: number;
    category?: string;
    categorySlug?: string;
    createdAt?: string;
    state?: string;
    labels?: Array<{
        name: string;
        color?: string; // hex without '#'
    }>;
    upvotes?: number;
};

// Configure your GitHub org/repo here.
const GITHUB_OWNER = 'Agenta-AI';
const GITHUB_REPO = 'agenta';
const NEW_DISCUSSION_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/discussions/new?category=ideas`;

// We will use the Discussions list API via the REST endpoint.
// Note: For unauthenticated requests there is a low rate-limit. You can
// set an environment var in production to add a token if needed and pass it
// through a runtime-config script, or rely on unauthenticated for now.
async function fetchDiscussions(signal?: AbortSignal): Promise<GithubDiscussion[]> {
    // Paginate to collect more "Ideas" items, not just the first page
    const perPage = 50;
    const maxPages = 5; // cap to avoid too many requests client-side
    const collected: GithubDiscussion[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/discussions?per_page=${perPage}&state=open&sort=created&direction=desc&page=${page}`;
        const res = await fetch(url, {
            headers: {
                Accept: 'application/vnd.github+json',
            },
            signal,
        });
        if (!res.ok) {
            break;
        }
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
            break;
        }

        const normalized: GithubDiscussion[] = (data || []).map((d: any) => ({
            id: String(d.id),
            title: d.title as string,
            url: d.html_url as string,
            comments: d.comments as number,
            category: d.category?.name as string | undefined,
            categorySlug: d.category?.slug as string | undefined,
            createdAt: d.created_at as string | undefined,
            state: d.state as string | undefined,
            labels: Array.isArray(d.labels)
                ? d.labels.map((l: any) => ({ name: String(l.name), color: l.color ? String(l.color) : undefined }))
                : [],
            upvotes: typeof d?.reactions?.["+1"] === 'number' ? Number(d.reactions["+1"]) : 0,
        }));

        const onlyIdeasOpen = normalized.filter((d) => {
            const cat = (d.categorySlug ?? d.category ?? '').toLowerCase();
            const isIdeas = cat === 'ideas';
            const isOpen = (d.state ?? '').toLowerCase() === 'open';
            return isIdeas && isOpen;
        });

        collected.push(...onlyIdeasOpen);

        if (data.length < perPage) {
            // no more pages
            break;
        }
    }

    // Sort by createdAt DESC (most recent first)
    collected.sort((a, b) => {
        const da = a.createdAt ? Date.parse(a.createdAt) : 0;
        const db = b.createdAt ? Date.parse(b.createdAt) : 0;
        return db - da;
    });

    return collected;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <h2 className={styles.sectionHeader}>{children}</h2>
    );
}

function getCategoryIcon(categoryName: string): string {
    const icons: Record<string, string> = {
        'Playground': '🎮',
        'Evaluation': '📊',
        'Observability': '👁️',
        'SDK': '⚙️',
        'API': '🔗',
        'UI': '🎨',
        'Performance': '⚡',
        'Security': '🔒',
        'Integration': '🔌',
        'Analytics': '📈',
        'Workflow': '🔄',
        'Testing': '🧪',
        'Documentation': '📝',
        'DevOps': '🚀',
    };
    return icons[categoryName] || '🏷️';
}

function LabelsInline({ labels, variant = 'colored' }: { labels?: Label[]; variant?: 'colored' | 'neutral' }) {
    if (!labels || labels.length === 0) return null;
    return (
        <span className={styles.labelsRowInline}>
            {labels.map((l) => (
                <span
                    key={l.name}
                    className={styles.labelChip}
                    style={variant === 'neutral' ? undefined : (l.color ? { ['--chip-bg' as any]: `#${l.color}` } : undefined)}
                >
                    <span className={styles.labelIcon} aria-hidden="true">{getCategoryIcon(l.name)}</span>
                    {l.name}
                </span>
            ))}
        </span>
    );
}

function FeatureCardClickable({
    title,
    description,
    href,
    labels,
    date,
    target = "_blank",
}: {
    title: string;
    description?: string;
    href: string;
    labels?: Label[];
    date?: string;
    target?: string;
}) {
    return (
        <a
            className={styles.featureCard}
            href={href}
            target={target}
            rel={target === "_blank" ? "noreferrer noopener" : undefined}
        >
            <div className={styles.featureTitleRow}>
                <div className={styles.featureTitleAndDate}>
                    <div className={styles.featureTitle}>{title}</div>
                    {date && (
                        <div className={styles.featureMetaDateInline}>
                            {new Date(date).toLocaleDateString()}
                        </div>
                    )}
                </div>
                <div className={styles.featureTitleRight}>
                    <LabelsInline labels={labels} />
                </div>
            </div>
            {description && <div className={styles.featureDescription}>{description}</div>}
        </a>
    );
}

function DiscussionsTable() {
    return (
        <BrowserOnly>
            {() => <DiscussionsTableClient />}
        </BrowserOnly>
    );
}

type SortOption = 'created' | 'upvotes' | 'comments';

function DiscussionsTableClient() {
    const [discussions, setDiscussions] = useState<GithubDiscussion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<SortOption>('created');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    useEffect(() => {
        const controller = new AbortController();
        fetchDiscussions(controller.signal)
            .then(setDiscussions)
            .catch(() => setError('Failed to load discussions'));
        return () => controller.abort();
    }, []);

    if (error) {
        return <div className={styles.errorBox}>{error}</div>;
    }
    if (!discussions) {
        return <div className={styles.loading}>Loading GitHub discussions…</div>;
    }
    if (discussions.length === 0) {
        return <div className={styles.empty}>No open discussions found.</div>;
    }

    // Sort discussions
    const sortedDiscussions = [...discussions].sort((a, b) => {
        switch (sortBy) {
            case 'upvotes':
                return (b.upvotes || 0) - (a.upvotes || 0);
            case 'comments':
                return b.comments - a.comments;
            case 'created':
            default:
                const da = a.createdAt ? Date.parse(a.createdAt) : 0;
                const db = b.createdAt ? Date.parse(b.createdAt) : 0;
                return db - da;
        }
    });

    // Paginate discussions
    const totalPages = Math.ceil(sortedDiscussions.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedDiscussions = sortedDiscussions.slice(startIndex, startIndex + itemsPerPage);

    return (
        <div>
            <div className={styles.discussionsControls}>
                <div className={styles.sortControls}>
                    <label className={styles.sortLabel}>Sort by:</label>
                    <select
                        className={styles.sortSelect}
                        value={sortBy}
                        onChange={(e) => {
                            setSortBy(e.target.value as SortOption);
                            setCurrentPage(1);
                        }}
                    >
                        <option value="created">Newest</option>
                        <option value="upvotes">Most upvoted</option>
                        <option value="comments">Most commented</option>
                    </select>
                </div>
                <div className={styles.resultsInfo}>
                    Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, sortedDiscussions.length)} of {sortedDiscussions.length} discussions
                </div>
            </div>

            <div className={styles.cardsGrid}>
                {paginatedDiscussions.map((d) => (
                    <div
                        key={d.id}
                        className={styles.card}
                        role="link"
                        tabIndex={0}
                        onClick={() => window.open(d.url, '_blank', 'noopener,noreferrer')}
                        onKeyDown={(e) => { if (e.key === 'Enter') window.open(d.url, '_blank', 'noopener,noreferrer'); }}
                    >
                        <div className={styles.voteColumn}>
                            <button
                                aria-label={`Open on GitHub to upvote`}
                                type="button"
                                className={styles.upvoteButton}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(d.url, '_blank', 'noopener,noreferrer');
                                }}
                            >
                                <svg aria-hidden="true" height="16" width="16" viewBox="0 0 16 16" className={styles.upvoteIcon}>
                                    <path d="M3.47 7.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018L9 4.81v7.44a.75.75 0 0 1-1.5 0V4.81L4.53 7.78a.75.75 0 0 1-1.06 0Z" />
                                </svg>
                                <span className={styles.upvoteCount}>{(typeof d.upvotes === 'number' ? d.upvotes : 0) + 1}</span>
                            </button>
                        </div>
                        <div className={styles.cardMain}>
                            <div className={styles.cardHeader}>
                                <div className={styles.cardTitle}>{d.title}</div>
                                <div className={styles.metaRow}>
                                    <a
                                        className={styles.commentsLink}
                                        href={d.url}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        aria-label={`${d.comments} comments`}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <svg aria-hidden="true" height="16" width="16" viewBox="0 0 16 16" className={styles.commentIcon}>
                                            <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
                                        </svg>
                                        {d.comments}
                                    </a>
                                    {d.createdAt && (
                                        <time className={styles.createdAt} dateTime={d.createdAt}>
                                            {new Date(d.createdAt).toLocaleDateString()}
                                        </time>
                                    )}
                                    <span className={styles.metaSpacer} />
                                    {Array.isArray(d.labels) && d.labels.length > 0 && (
                                        <span className={styles.labelsRowInline}>
                                            {d.labels.map((l) => (
                                                <span
                                                    key={l.name}
                                                    className={styles.labelChip}
                                                    style={l.color ? { ['--chip-bg' as any]: `#${l.color}` } : undefined}
                                                >
                                                    {l.name}
                                                </span>
                                            ))}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {totalPages > 1 && (
                <div className={styles.pagination}>
                    <button
                        className={clsx(styles.paginationButton, { [styles.disabled]: currentPage === 1 })}
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                    >
                        Previous
                    </button>

                    <div className={styles.paginationNumbers}>
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                            <button
                                key={page}
                                className={clsx(styles.paginationNumber, { [styles.active]: page === currentPage })}
                                onClick={() => setCurrentPage(page)}
                            >
                                {page}
                            </button>
                        ))}
                    </div>

                    <button
                        className={clsx(styles.paginationButton, { [styles.disabled]: currentPage === totalPages })}
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}

export default function RoadmapPage() {
    const { siteConfig } = useDocusaurusContext();
    const pageTitle = 'Roadmap';
    const pageDescription = 'What we shipped, what we are building next, and what we plan to build.';

    return (
        <Layout title={pageTitle} description={pageDescription}>
            <main className={styles.container}>
                <header className={styles.pageHeader}>
                    <h1 className={styles.pageTitle}>Roadmap</h1>
                    <p className={styles.pageSubtitle}>{pageDescription}</p>
                </header>

                <SectionHeader>Last Shipped</SectionHeader>
                <div className={styles.sectionList}>
                    {shippedFeatures.slice(0, 7).map((f: ShippedFeature) => (
                        <FeatureCardClickable
                            key={f.id}
                            title={f.title}
                            description={f.description}
                            href={f.changelogPath}
                            labels={f.labels}
                            date={f.shippedAt}
                            target="_self"
                        />
                    ))}
                    {shippedFeatures.length === 0 && (
                        <div className={styles.empty}>No shipped items listed yet.</div>
                    )}
                </div>

                <SectionHeader>In progress</SectionHeader>
                <div className={styles.sectionList}>
                    {inProgressFeatures.map((f: PlannedFeature) => (
                        <FeatureCardClickable
                            key={f.id}
                            title={f.title}
                            description={f.description}
                            href={f.githubUrl}
                            labels={f.labels}
                        />
                    ))}
                    {inProgressFeatures.length === 0 && (
                        <div className={styles.empty}>No in-progress items listed yet.</div>
                    )}
                </div>

                <SectionHeader>Planned</SectionHeader>
                <div className={styles.sectionList}>
                    {plannedFeatures.map((f: PlannedFeature) => (
                        <FeatureCardClickable
                            key={f.id}
                            title={f.title}
                            description={f.description}
                            href={f.githubUrl}
                            labels={f.labels}
                        />
                    ))}
                    {plannedFeatures.length === 0 && (
                        <div className={styles.empty}>No planned items listed yet.</div>
                    )}
                </div>

                <SectionHeader>Feature Requests</SectionHeader>
                <p className={styles.discussionsIntro}>
                    Upvote or comment on the features you care about or request a new feature.
                </p>
                <div className={styles.actionsBar}>
                    <a
                        className={clsx('nav_primary_button', styles.primaryAction)}
                        href={NEW_DISCUSSION_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        Request a feature
                    </a>
                </div>
                <DiscussionsTable />
            </main>
        </Layout>
    );
}


