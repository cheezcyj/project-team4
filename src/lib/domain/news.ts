export interface NewsArticle {
  id: string;
  title: string;
  source: '보건복지부';
  author: string | null;
  published_at: string | null;
  url: string;
  summary: string;
  license: 'KOGL-1';
  license_url: string;
  fetched_at: string;
}

export interface NewsFeed {
  articles: NewsArticle[];
  configured: true;
  provider: 'mohw';
  refresh: {
    status: 'fresh' | 'stale';
    last_success_at: string;
    error: string | null;
    automatic: true;
  };
  source_url: string;
}
