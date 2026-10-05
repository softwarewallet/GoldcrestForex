// ============================================================================
// NEWS INTELLIGENCE LAYER (PHASE 3)
// ============================================================================

import { LiveNewsArticle } from '../../services/liveNewsService';
import { NewsIntelligence } from './types';

export interface RawNewsArticle {
  title: string;
  summary?: string;
  source?: string;
  publishedAt?: string | number | null;
  sentimentScore?: number;
  sentimentLabel?: string;
  topics?: string[];
}

export class NewsIntelligenceEngine {
  private static CURRENCY_KEYWORDS: Record<string, RegExp[]> = {
    USD: [/\busd\b/i, /us dollar/i, /u\.s\. dollar/i, /\bfed\b/i, /federal reserve/i, /\bfomc\b/i, /powell/i, /treasury/i, /wall street/i],
    EUR: [/\beur\b/i, /\beuro\b/i, /\becb\b/i, /european central bank/i, /lagarde/i, /eurozone/i, /bund/i],
    GBP: [/\bgbp\b/i, /\bpound\b/i, /sterling/i, /\bboe\b/i, /bank of england/i, /bailey/i, /gilt/i, /uk economy/i],
    JPY: [/\bjpy\b/i, /\byen\b/i, /\bboj\b/i, /bank of japan/i, /ueda/i, /tokyo/i, /yield curve control/i],
    CHF: [/\bchf\b/i, /swiss franc/i, /\bsnb\b/i, /swiss national bank/i, /jordan/i],
    AUD: [/\baud\b/i, /aussie/i, /australian dollar/i, /\brba\b/i, /reserve bank of australia/i, /bullock/i],
    NZD: [/\bnzd\b/i, /kiwi/i, /new zealand dollar/i, /\brbnz\b/i, /reserve bank of new zealand/i, /orr/i],
    CAD: [/\bcad\b/i, /loonie/i, /canadian dollar/i, /\bboc\b/i, /bank of canada/i, /macklem/i],
    XAU: [/\bxau\b/i, /\bgold\b/i, /bullion/i, /precious metal/i]
  };

  private static BULLISH_KEYWORDS = [
    /\bhike\b/i, /rate hike/i, /hawkish/i, /tightening/i, /\brall(?:y|ies|ied)\b/i,
    /\bsurg(?:e|es|ed)\b/i, /\bgain(?:s|ed)?\b/i, /\bjump(?:s|ed)?\b/i, /\bsoar(?:s|ed)?\b/i,
    /\boutperform(?:s|ed)?\b/i, /\bstronger\b/i, /\bstrength\b/i, /\bbeat(?:s)?\b/i,
    /\bhigher than expected\b/i, /\bgrowth accelerates\b/i, /\bupbeat\b/i, /\bbullish\b/i
  ];

  private static BEARISH_KEYWORDS = [
    /\bcut\b/i, /rate cut/i, /dovish/i, /easing/i, /\bfall(?:s|en)?\b/i,
    /\bdrop(?:s|ped)?\b/i, /\bplung(?:e|es|ed)\b/i, /\bslump(?:s|ed)?\b/i,
    /\btumbl(?:e|es|ed)\b/i, /\bweaker\b/i, /\bweakness\b/i, /\bmiss(?:es|ed)?\b/i,
    /\blower than expected\b/i, /\bslowdown\b/i, /\brecession\b/i, /\bbearish\b/i,
    /\bdownturn\b/i, /\bheadwind\b/i
  ];

  private static MACRO_HIGH_IMPACT_KEYWORDS = [
    /interest rate/i, /rate decision/i, /central bank/i, /monetary policy/i,
    /\bcpi\b/i, /inflation/i, /nonfarm payroll/i, /\bnfp\b/i, /unemployment/i,
    /\bgdp\b/i, /\bpmi\b/i, /\bfomc\b/i, /press conference/i
  ];

  private static REPUTABLE_SOURCES = new Set([
    'reuters', 'bloomberg', 'financial times', 'wsj', 'wall street journal',
    'cnbc', 'marketwatch', 'fxstreet', 'dailyfx', 'forexlive', 'investing.com'
  ]);

  /**
   * Analyzes news articles relative to a specific currency pair up to a strict cutoff timestamp.
   * GUARANTEE: Never analyzes articles published after cutoffTimestamp.
   */
  public static analyzeNewsForPair(
    pair: string,
    articles: (LiveNewsArticle | RawNewsArticle)[],
    cutoffTimestamp: number = Date.now(),
    technicalDirection?: 'BUY' | 'SELL' | 'NEUTRAL'
  ): NewsIntelligence {
    const parts = pair.toUpperCase().split('/');
    const baseCurr = parts[0] || 'EUR';
    const quoteCurr = parts[1] || 'USD';

    // 1. Filter out articles published after cutoffTimestamp
    const validArticles = articles.filter(a => {
      if (!a.publishedAt) return false;
      const pubTime = typeof a.publishedAt === 'number' ? a.publishedAt : new Date(a.publishedAt).getTime();
      return Number.isFinite(pubTime) && pubTime <= cutoffTimestamp;
    });

    // 2. De-duplicate articles by normalized title
    const uniqueArticles: (LiveNewsArticle | RawNewsArticle)[] = [];
    const seenTitles = new Set<string>();

    for (const a of validArticles) {
      const norm = (a.title || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().slice(0, 40);
      if (norm && !seenTitles.has(norm)) {
        seenTitles.add(norm);
        uniqueArticles.push(a);
      }
    }

    let baseScoreSum = 0;
    let baseWeightSum = 0;
    let quoteScoreSum = 0;
    let quoteWeightSum = 0;
    let highImpactCount = 0;
    let totalQualitySum = 0;
    let totalFreshnessSum = 0;
    const dominantHeadlines: string[] = [];

    const now = cutoffTimestamp;

    for (const article of uniqueArticles) {
      const text = `${article.title} ${article.summary || ''}`;
      const pubTime = typeof article.publishedAt === 'number' ? article.publishedAt : new Date(article.publishedAt!).getTime();
      const ageHours = Math.max(0, (now - pubTime) / (1000 * 3600));

      // Exponential freshness decay: half-life of 8 hours
      const freshness = Math.exp(-ageHours / 8);
      totalFreshnessSum += freshness;

      // Source reliability
      const srcName = (article.source || '').toLowerCase();
      const isReputable = Array.from(this.REPUTABLE_SOURCES).some(s => srcName.includes(s));
      const sourceWeight = isReputable ? 1.0 : 0.65;
      totalQualitySum += sourceWeight;

      // Market impact check
      const isHighImpact = this.MACRO_HIGH_IMPACT_KEYWORDS.some(k => k.test(text));
      if (isHighImpact) highImpactCount++;
      const impactMultiplier = isHighImpact ? 1.8 : 1.0;

      const combinedWeight = freshness * sourceWeight * impactMultiplier;

      // Check base currency relevance
      const isBaseRelevant = this.checkCurrencyRelevance(baseCurr, text);
      const isQuoteRelevant = this.checkCurrencyRelevance(quoteCurr, text);

      const sentiment = this.computeTextSentiment(text);

      if (isBaseRelevant) {
        baseScoreSum += sentiment * combinedWeight;
        baseWeightSum += combinedWeight;
        if (Math.abs(sentiment) >= 0.4 && dominantHeadlines.length < 3) {
          dominantHeadlines.push(`[${baseCurr}] ${article.title}`);
        }
      }

      if (isQuoteRelevant) {
        quoteScoreSum += sentiment * combinedWeight;
        quoteWeightSum += combinedWeight;
        if (Math.abs(sentiment) >= 0.4 && dominantHeadlines.length < 3) {
          dominantHeadlines.push(`[${quoteCurr}] ${article.title}`);
        }
      }
    }

    const baseSentiment = baseWeightSum > 0 ? Math.max(-1, Math.min(1, baseScoreSum / baseWeightSum)) : 0;
    const quoteSentiment = quoteWeightSum > 0 ? Math.max(-1, Math.min(1, quoteScoreSum / quoteWeightSum)) : 0;

    // Relative sentiment for pair:
    // Base positive = pair bullish (+)
    // Quote positive = pair bearish (-)
    // Diff ranges from -2 to +2, normalize to -1 to +1
    const rawRelative = baseSentiment - quoteSentiment;
    const relativeSentiment = Math.max(-1, Math.min(1, rawRelative / 1.5));
    const sentimentStrength = Math.min(1, Math.abs(relativeSentiment));

    const relevantCount = Math.round((baseWeightSum > 0 ? 1 : 0) + (quoteWeightSum > 0 ? 1 : 0));
    const marketImpactScore = uniqueArticles.length > 0 ? Math.min(1, highImpactCount / Math.max(1, uniqueArticles.length * 0.4)) : 0;
    const freshnessScore = uniqueArticles.length > 0 ? Math.min(1, totalFreshnessSum / uniqueArticles.length) : 0;
    const sourceQualityScore = uniqueArticles.length > 0 ? Math.min(1, totalQualitySum / uniqueArticles.length) : 0;
    const eventRiskScore = Math.min(1, marketImpactScore * 0.7 + (highImpactCount > 0 ? 0.3 : 0));

    // Direction
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (relativeSentiment >= 0.22) direction = 'BULLISH';
    else if (relativeSentiment <= -0.22) direction = 'BEARISH';

    // Conflict detection with technical setup
    let conflictScore = 0;
    if (technicalDirection === 'BUY' && direction === 'BEARISH') {
      conflictScore = Math.min(1, 0.5 + Math.abs(relativeSentiment) * 0.5);
    } else if (technicalDirection === 'SELL' && direction === 'BULLISH') {
      conflictScore = Math.min(1, 0.5 + Math.abs(relativeSentiment) * 0.5);
    }

    return {
      pair,
      timestamp: cutoffTimestamp,
      relevantArticles: uniqueArticles.length,
      baseCurrencySentiment: Number(baseSentiment.toFixed(3)),
      quoteCurrencySentiment: Number(quoteSentiment.toFixed(3)),
      relativeSentiment: Number(relativeSentiment.toFixed(3)),
      sentimentStrength: Number(sentimentStrength.toFixed(3)),
      marketImpactScore: Number(marketImpactScore.toFixed(3)),
      freshnessScore: Number(freshnessScore.toFixed(3)),
      sourceQualityScore: Number(sourceQualityScore.toFixed(3)),
      conflictScore: Number(conflictScore.toFixed(3)),
      eventRiskScore: Number(eventRiskScore.toFixed(3)),
      direction,
      dominantHeadlines
    };
  }

  private static checkCurrencyRelevance(currency: string, text: string): boolean {
    const patterns = this.CURRENCY_KEYWORDS[currency];
    if (!patterns) return false;
    return patterns.some(p => p.test(text));
  }

  private static computeTextSentiment(text: string): number {
    let score = 0;
    for (const pat of this.BULLISH_KEYWORDS) {
      if (pat.test(text)) score += 1;
    }
    for (const pat of this.BEARISH_KEYWORDS) {
      if (pat.test(text)) score -= 1;
    }

    if (score === 0) return 0;
    return Math.max(-1, Math.min(1, score * 0.35));
  }
}
