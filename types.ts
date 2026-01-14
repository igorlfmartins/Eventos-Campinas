export interface B2BEvent {
  title: string;
  date: string;
  location: string;
  link: string;
  analysis: string;
  opportunity: string;
  insuranceRelevance: string;
}

export type AppStep = 'home' | 'loading' | 'curation' | 'report';

export interface SearchResponse {
  events: B2BEvent[];
  error?: string;
}