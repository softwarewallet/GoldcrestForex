import { GoogleGenAI } from '@google/genai';
import { CompletePairAnalysisResponse } from '../markets/forex/types';

const SYSTEM_INSTRUCTION = `You are an Advanced Quantitative Predictive Engine specializing in Multi-Timeframe Order Flow and Liquidity Analysis for Forex Major pairs. Your objective is to combine multi-source news sentiment, macro structure, and micro-execution parameters to output a hyper-optimized trading policy.

### Input Data Extensions:
1. macroStructure: { timeframe_1H_trend: "BULLISH" | "BEARISH" | "CHOPPY", key_1H_liquidity_pools: Array }
2. marketVelocity: { atr_5M: float, current_session: "LONDON" | "NEW_YORK" | "TOKYO" | "GAP" }
3. newsSentiment & systemSafetyCaps.

### Profit Optimization & Filtering Mandates:
1. Macro Alignment Filter:
- Before checking the 5-Minute EMA, verify the timeframe_1H_trend.
- You are strictly FORBIDDEN from issuing a BUY order if the 1H trend is BEARISH, and forbidden from issuing a SELL order if the 1H trend is BULLISH. If the macro trend is CHOPPY, scale down confidence instantly.
2. Volatility-Based Target Scaling:
- Instead of using fixed pip targets, dynamically scale your TP and SL using the incoming atr_5M variable.
- Set your dynamic_stop_loss_pips to exactly 1.2x the current 5M ATR.
- Set your dynamic_take_profit_pips to 2x the calculated Stop Loss to maintain a mathematically superior 1:2 Risk-to-Reward ratio, provided it does not hit a major 1H liquidity pool or structural barrier.
3. Session Risk Filter:
- If current_session matches "GAP" or "TOKYO", automatically apply a safety penalty to the confidence_score, keeping it below your 0.88 execution gate unless news sentiment is overwhelmingly one-sided (>0.95 absolute delta).

Never invent market data.
Never guarantee a market outcome.
Never modify calculated numerical values.
Clearly distinguish observed data from analytical interpretation.
Explain why the quantitative engine produced the supplied signal.
If evidence conflicts, explicitly state the conflict.
If the correct result is NO TRADE, explain why.

You must structure your response with the following 7 sections:
1. Market summary
2. Trend explanation
3. Supporting evidence
4. Conflicting evidence
5. Trade-plan explanation
6. Main risks
7. Invalidation conditions`;

export interface GeminiExplanationResult {
  pair: string;
  timestamp: number;
  explanationText: string;
  sections: {
    marketSummary: string;
    trendExplanation: string;
    supportingEvidence: string[];
    conflictingEvidence: string[];
    tradePlanExplanation: string;
    mainRisks: string[];
    invalidationConditions: string[];
  };
  generatedByAi: boolean;
}

export async function explainForexAnalysis(
  analysis: CompletePairAnalysisResponse
): Promise<GeminiExplanationResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || !apiKey.startsWith('AIza')) {
    // Graceful deterministic explanation when valid GEMINI_API_KEY is not configured
    return generateDeterministicExplanation(analysis);
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
    const prompt = `Explain the following quantitative Forex analysis according to your instructions:

ANALYSIS PAYLOAD:
${JSON.stringify(analysis, null, 2)}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2
      }
    });

    const text = response.text || '';
    return parseExplanationIntoSections(analysis.pair, text);
  } catch {
    return generateDeterministicExplanation(analysis);
  }
}

function parseExplanationIntoSections(pair: string, rawText: string): GeminiExplanationResult {
  const lines = rawText.split('\n');
  const sections: GeminiExplanationResult['sections'] = {
    marketSummary: '',
    trendExplanation: '',
    supportingEvidence: [],
    conflictingEvidence: [],
    tradePlanExplanation: '',
    mainRisks: [],
    invalidationConditions: []
  };

  let currentSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (/1\.\s*market\s*summary/i.test(trimmed)) {
      currentSection = 'marketSummary';
    } else if (/2\.\s*trend\s*explanation/i.test(trimmed)) {
      currentSection = 'trendExplanation';
    } else if (/3\.\s*supporting\s*evidence/i.test(trimmed)) {
      currentSection = 'supportingEvidence';
    } else if (/4\.\s*conflicting\s*evidence/i.test(trimmed)) {
      currentSection = 'conflictingEvidence';
    } else if (/5\.\s*trade-plan\s*explanation/i.test(trimmed) || /5\.\s*trade\s*plan/i.test(trimmed)) {
      currentSection = 'tradePlanExplanation';
    } else if (/6\.\s*main\s*risks/i.test(trimmed)) {
      currentSection = 'mainRisks';
    } else if (/7\.\s*invalidation\s*conditions/i.test(trimmed)) {
      currentSection = 'invalidationConditions';
    } else if (trimmed) {
      if (currentSection === 'marketSummary') {
        sections.marketSummary += (sections.marketSummary ? ' ' : '') + trimmed;
      } else if (currentSection === 'trendExplanation') {
        sections.trendExplanation += (sections.trendExplanation ? ' ' : '') + trimmed;
      } else if (currentSection === 'tradePlanExplanation') {
        sections.tradePlanExplanation += (sections.tradePlanExplanation ? ' ' : '') + trimmed;
      } else if (currentSection === 'supportingEvidence') {
        sections.supportingEvidence.push(trimmed.replace(/^[-*•\d.]\s*/, ''));
      } else if (currentSection === 'conflictingEvidence') {
        sections.conflictingEvidence.push(trimmed.replace(/^[-*•\d.]\s*/, ''));
      } else if (currentSection === 'mainRisks') {
        sections.mainRisks.push(trimmed.replace(/^[-*•\d.]\s*/, ''));
      } else if (currentSection === 'invalidationConditions') {
        sections.invalidationConditions.push(trimmed.replace(/^[-*•\d.]\s*/, ''));
      }
    }
  }

  // Fallbacks if formatting differed
  if (!sections.marketSummary) sections.marketSummary = rawText.slice(0, 300);

  return {
    pair,
    timestamp: Date.now(),
    explanationText: rawText,
    sections,
    generatedByAi: true
  };
}

function generateDeterministicExplanation(analysis: CompletePairAnalysisResponse): GeminiExplanationResult {
  const isNoTrade = analysis.signal.direction === 'NO_TRADE';
  const isBuy = analysis.signal.direction.includes('BUY');
  const isSell = analysis.signal.direction.includes('SELL');
  const bs = analysis.bounceStrategy;

  const marketSummary = `${analysis.pair} is currently trading at ${analysis.currentPrice.toFixed(5)} under a ${analysis.regime} regime in the ${analysis.session} session. The quantitative signal is ${analysis.signal.direction} (${bs?.setupState ?? analysis.signal.status}) with an aggregate score of ${analysis.signal.score}/100.`;

  const trendExplanation = bs?.trendReason
    ? `Step 1 (Trend): ${bs.trendReason} ${bs.zoneReason ? `| Step 2 (Zone): ${bs.zoneReason}` : ''} | Alignment: ${analysis.multiTimeframe.alignment}.`
    : `The macro market structure displays a ${analysis.marketStructure.type} pattern in a ${analysis.marketStructure.phase} phase. Multi-timeframe trend alignment is evaluated as ${analysis.multiTimeframe.alignment} (${analysis.multiTimeframe.summary}).`;

  const supportingEvidence: string[] = [];
  if (bs) {
    supportingEvidence.push(`Step 1 (5M 50 EMA): ${bs.trendReason}`);
    supportingEvidence.push(`Step 2 (Bounce Zone): ${bs.zoneReason}`);
    supportingEvidence.push(`Step 3 (Rejection Trigger): ${bs.triggerReason}`);
    if (bs.rejection?.hasRejection) {
      supportingEvidence.push(`5M Rejection Candle Details: ${bs.rejection.summary} (wick: ${bs.rejection.wickPips}p, ratio: ${bs.rejection.wickRatio}x body).`);
    }
  } else {
    supportingEvidence.push(`Price action printing ${analysis.marketStructure.type} on execution candles.`);
  }

  if (analysis.indicators.rsi !== null) {
    supportingEvidence.push(`RSI is measured at ${analysis.indicators.rsi}.`);
  }
  supportingEvidence.push(`Nearest significant Support at ${analysis.supportResistance.nearestSupport ?? 'N/A'} and Resistance at ${analysis.supportResistance.nearestResistance ?? 'N/A'}.`);

  const conflictingEvidence: string[] = [];
  if (analysis.warnings.length > 0) {
    conflictingEvidence.push(...analysis.warnings);
  }
  if (bs && bs.setupState === 'WAITING_FOR_PULLBACK') {
    conflictingEvidence.push(`Price has not yet completed its pullback into key ${bs.keyLevelType} level (${bs.distanceToLevelPips} pips away).`);
  }
  if (bs && bs.setupState === 'TESTING_ZONE' && !bs.rejection.hasRejection) {
    conflictingEvidence.push(`Price is currently testing the ${bs.keyLevelType} zone, but the 5M candle has not yet closed with a confirmed rejection wick.`);
  }
  if (analysis.multiTimeframe.alignment === 'CONFLICTING') {
    conflictingEvidence.push('Higher timeframes conflict with lower timeframe execution trend.');
  }
  if (conflictingEvidence.length === 0) {
    conflictingEvidence.push('No severe directional divergence identified across multi-timeframe inputs.');
  }

  let tradePlanExplanation = 'No active trade plan is established due to filtering conditions.';
  if (analysis.tradePlan) {
    tradePlanExplanation = `Entry zone defined between ${analysis.tradePlan.entryMin} and ${analysis.tradePlan.entryMax} (Preferred: ${((analysis.tradePlan.entryMin + analysis.tradePlan.entryMax) / 2).toFixed(5)}). Stop-Loss set at ${analysis.tradePlan.stopLoss} (${analysis.tradePlan.stopLossReason}). Target 1 at ${analysis.tradePlan.takeProfit1} provides a ${analysis.tradePlan.riskReward}:1 Risk/Reward ratio.`;
  }

  const mainRisks: string[] = [
    `Macroeconomic volatility shifts during active ${analysis.session} session.`,
    `Spread widening during liquidity transitions.`,
    isBuy ? `Break below key structural support at ${analysis.supportResistance.nearestSupport ?? analysis.tradePlan?.stopLoss}.` : `Break above key structural resistance at ${analysis.supportResistance.nearestResistance ?? analysis.tradePlan?.stopLoss}.`
  ];

  const invalidationConditions: string[] = [
    isBuy ? `5M candle close below rejection wick low at ${analysis.tradePlan?.stopLoss ?? analysis.supportResistance.nearestSupport}.` : `5M candle close above rejection wick high at ${analysis.tradePlan?.stopLoss ?? analysis.supportResistance.nearestResistance}.`,
    bs?.ema50 ? `Price crossing opposite side of 5M 50 EMA (${bs.ema50}).` : `Trend alignment deterioration across 1H and 4H timeframes.`,
    `High-impact central bank announcement within 20 minutes.`
  ];

  const rawText = `1. Market summary\n${marketSummary}\n\n2. Trend explanation\n${trendExplanation}\n\n3. Supporting evidence\n${supportingEvidence.map(s => `- ${s}`).join('\n')}\n\n4. Conflicting evidence\n${conflictingEvidence.map(c => `- ${c}`).join('\n')}\n\n5. Trade-plan explanation\n${tradePlanExplanation}\n\n6. Main risks\n${mainRisks.map(r => `- ${r}`).join('\n')}\n\n7. Invalidation conditions\n${invalidationConditions.map(i => `- ${i}`).join('\n')}`;

  return {
    pair: analysis.pair,
    timestamp: Date.now(),
    explanationText: rawText,
    sections: {
      marketSummary,
      trendExplanation,
      supportingEvidence,
      conflictingEvidence,
      tradePlanExplanation,
      mainRisks,
      invalidationConditions
    },
    generatedByAi: false
  };
}
