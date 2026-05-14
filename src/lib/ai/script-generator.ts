// ============================================================
// Template-Based Script Generator -- Zero API Cost
// Takes stock info and auto-generates scripts, scenes, and SEO
// No external AI API required
// ============================================================

import type { GeneratedScript, GeneratedScene, GeneratedSEO, VideoTone, VideoStyle } from '@/types';

// ============================================================
// Utility helpers
// ============================================================

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

// ============================================================
// Sector detection from stock name + provided info
// ============================================================

function detectSector(stockName: string, info: string): string {
  const t = `${stockName} ${info}`.toLowerCase();
  if (/bank|finance|nbfc|insurance|hdfc|icici|axis|kotak|sbi|pnb|canara/.test(t)) return 'Banking & Finance';
  if (/tech|it|software|infosys|tcs|wipro|hcl|tech mahindra|mphasis|ltimindtree/.test(t)) return 'IT & Technology';
  if (/auto|motor|car|vehicle|tata motors|maruti|bajaj|hero|eicher|m&m|mahindra/.test(t)) return 'Automobile';
  if (/pharma|drug|medicine|sun pharma|cipla|dr reddy|biocon|lupin|zydus|alkem/.test(t)) return 'Pharmaceuticals';
  if (/fmcg|consumer|food|hul|nestle|itc|dabur|marico|godrej consumer|emami/.test(t)) return 'FMCG';
  if (/energy|oil|gas|power|reliance|ongc|ntpc|tata power|adani green|torrent/.test(t)) return 'Energy';
  if (/steel|metal|mining|tata steel|jsw|hindalco|vedanta|coal india|nmdc/.test(t)) return 'Metals & Mining';
  if (/real estate|realty|dlf|godrej property|prestige|oberoi|brigade/.test(t)) return 'Real Estate';
  if (/telecom|airtel|jio|vodafone|indus towers/.test(t)) return 'Telecom';
  if (/infra|construction|l&t|larsen|irb|knr|rites|ircon/.test(t)) return 'Infrastructure';
  if (/cement|ultratech|shree|ambuja|acc|dalmia/.test(t)) return 'Cement';
  if (/retail|dmart|avenue|trent|titan|v-mart/.test(t)) return 'Retail';
  return 'Stock Market';
}

// ============================================================
// Hook templates -- 5 per tone, highly varied
// ============================================================

const HOOKS: Record<string, string[]> = {
  VIRAL: [
    "{stockName} just did something the market CANNOT ignore -- and most people have no idea what's coming!",
    "Everyone on Dalal Street is talking about {stockName} right now -- here's the FULL breakdown in 60 seconds!",
    'This {stockName} move is going VIRAL for a reason -- and you need to understand it before the next session!',
    '{ticker} traders are absolutely stunned right now -- let me show you exactly what happened and why it matters!',
    'If you own or watch {stockName}, stop everything -- this 60-second breakdown could change your perspective entirely!',
  ],
  AGGRESSIVE: [
    '{stockName} is setting up for a MASSIVE move -- and the bulls are firmly in control right now!',
    "Big money is quietly loading up on {stockName} -- here's the breakdown of why smart traders are paying attention!",
    "{ticker} just broke out and the momentum is UNDENIABLE -- here's the full technical and fundamental case!",
    '{stockName} is not playing games! The chart, the numbers, and the news are all pointing in the SAME direction!',
    "The {stockName} setup right now is one of the cleanest I've seen -- here's why this could be a major opportunity!",
  ],
  PROFESSIONAL: [
    "{stockName} presents a compelling investment case right now -- let's break down the key data points objectively.",
    'A data-driven analysis of {stockName}: the numbers, the narrative, and what it means for your portfolio.',
    'Why sophisticated investors are closely tracking {stockName} -- a balanced look at the fundamentals and risks.',
    '{stockName} ({ticker}): Breaking down the valuations, growth drivers, and what the numbers actually tell us.',
    "Is {stockName} worth your capital right now? Here's an objective, evidence-based analysis of the current setup.",
  ],
  EDUCATIONAL: [
    'Let me break down {stockName} in plain English -- everything you need to know in exactly 60 seconds!',
    "Never heard of {stockName}? Don't worry -- here's a complete beginner-friendly breakdown of what's happening!",
    'Understanding {stockName}: the business, the numbers, and the opportunity -- explained as simply as possible!',
    "What exactly is going on with {stockName}? I'll explain it clearly so anyone can understand the full picture!",
    "{stockName} simplified -- here's the business model, the key metrics, and why investors are paying attention!",
  ],
  URGENT: [
    'URGENT {stockName} update -- this is time-sensitive and every holder or watcher needs to see this right now!',
    "BREAKING: {stockName} development that changes what you thought you knew -- watch before tomorrow's market open!",
    "Critical {ticker} alert -- this information is too important to wait on. Here's the full picture right now!",
    "{stockName} news just dropped that has serious implications -- here's a rapid-fire breakdown of everything!",
    "You NEED to know about this {stockName} situation before the next trading session. Here's what happened!",
  ],
};

// ============================================================
// Main content body templates
// ============================================================

const BODY: Record<string, string[]> = {
  VIRAL: [
    "Here's the situation. {stockData} What makes this really interesting is {keyHighlight}. And with {positiveInfo} in the mix, this is a story the market simply cannot look away from.",
    "{stockName}, listed on NSE and BSE, has been making serious waves lately. {stockData} The catalyst? {positiveInfo} This is exactly the kind of setup that drives outsized moves.",
    "Let's get straight to the numbers. {stockData} Here's the standout metric -- {keyHighlight}. Layer on top of that {positiveInfo}, and you have a recipe for serious market attention.",
  ],
  AGGRESSIVE: [
    "{stockName} is not here to play games. {stockData} The bulls are firmly in control -- and here's the proof: {keyHighlight}. Combined with {positiveInfo}, this setup is screaming opportunity.",
    "Look at what's happening with {stockName}. {stockData} This is what a strong setup looks like. {keyHighlight} -- the fundamentals are backing the technicals and the timing is right.",
    "Here's why {ticker} has traders excited right now. {stockData} When you see {keyHighlight} combined with {positiveInfo}, that's when real moves happen in the market.",
  ],
  PROFESSIONAL: [
    "{stockName} currently shows the following key metrics: {stockData} From a valuation standpoint, {keyHighlight}. The catalyst of {positiveInfo} adds further weight to the investment case.",
    "Analyzing {stockName} objectively: {stockData} The most important data point here is {keyHighlight}. Recent positive developments include {positiveInfo}, which institutional investors will note.",
    "Let's examine {stockName} on its merits. {stockData} Worth highlighting: {keyHighlight}. The positive development of {positiveInfo} is a meaningful factor in the current thesis.",
  ],
  EDUCATIONAL: [
    "Here's the simple breakdown of {stockName}. {stockData} In plain terms -- {keyHighlight}. The reason this matters is {positiveInfo}. That's the core of what's happening.",
    "{stockName} is a company that {stockData} What does this mean for regular investors? {keyHighlight}. The exciting part is {positiveInfo} -- which is why people are paying attention.",
    "Let me simplify {stockName} for you. The key data: {stockData} Translation: {keyHighlight}. The opportunity here stems from {positiveInfo} -- and that's the heart of the story.",
  ],
  URGENT: [
    "Here's the urgent update. {stockData} The critical thing to understand right now is {keyHighlight}. The key development that triggered this is {positiveInfo} -- and the implications are significant.",
    "Time-sensitive {stockName} situation: {stockData} What has changed is {keyHighlight}. The trigger was {positiveInfo}. If you're holding or watching this stock, this context is essential.",
    "Breaking down the {stockName} alert: {stockData} The most important thing right now is {keyHighlight}. The development you need to know about is {positiveInfo}. Act on this information wisely.",
  ],
};

// ============================================================
// Why it matters templates
// ============================================================

const WHY: Record<string, string[]> = {
  VIRAL: [
    "Here's why this is bigger than most people realize -- {stockName} operates in a sector with powerful tailwinds right now. The macro is lining up perfectly, and the market is just starting to price it in.",
    "This isn't just a short-term story. The fundamentals behind {stockName} are building something that plays out over months. The smart money is recognizing this setup early -- and that's the real signal.",
    "When strong price action combines with solid fundamentals, you get exactly what {stockName} is showing -- a potential multi-bagger setup that most retail investors will only discover after the move is done.",
  ],
  AGGRESSIVE: [
    "{stockName} is at a critical inflection point. The bulls have momentum, volume is confirming, and the risk-reward tilts heavily in favor of buyers. The technical picture is as clean as it gets.",
    "The chart is clear, the fundamentals back it up, and the sector tailwind is real. {stockName} is checking every box for a powerful move. The question is not if -- it's when.",
    "Strong fundamentals, technical confirmation, and a real catalyst. {stockName} is ticking every single box. Traders who position early in these setups tend to capture the biggest part of the move.",
  ],
  PROFESSIONAL: [
    "{stockName} demonstrates the qualities that merit serious portfolio consideration -- a sustainable business model, a strong balance sheet, and clear visibility into future growth drivers.",
    "From a risk-adjusted perspective, {stockName} offers a compelling proposition. The downside appears well-supported by asset values, while the upside potential remains meaningful for patient investors.",
    "The investment case rests on three pillars: solid financials, favorable industry trends, and a management team with a track record of execution. All three are currently intact for {stockName}.",
  ],
  EDUCATIONAL: [
    "Here's the important lesson -- when a company shows these kinds of numbers, it often signals that the business is genuinely creating value. That's what separates quality stocks from the rest.",
    "The principle is straightforward: strong companies with growing revenues and profits tend to see that reflected in their stock price over time. {stockName} is demonstrating exactly this pattern.",
    "The reason investors track companies like {stockName} is because the stock market, over time, rewards businesses that grow their earnings. Understanding this is the foundation of smart investing.",
  ],
  URGENT: [
    "The window to act on this {stockName} information may be narrow. Markets move fast, and context like this gives you a real edge over investors who aren't paying close attention.",
    "This {stockName} development has implications that go beyond the immediate price move. It signals a potential shift in the company's trajectory -- one that long-term investors must evaluate carefully.",
    "In fast-moving markets, information is leverage. This {stockName} update gives you the context you need to make informed decisions -- whether that means holding, adding, or simply monitoring closely.",
  ],
};

// ============================================================
// Risk / opportunity one-liners
// ============================================================

const RISK: Record<string, string> = {
  VIRAL:        'Key risk: broader market volatility. Key opportunity: strong momentum with solid fundamentals -- a combination that historically drives outsized returns.',
  AGGRESSIVE:   'Manage your position size -- never risk more than you can afford. The opportunity is a high-conviction technical breakout backed by improving fundamentals.',
  PROFESSIONAL: 'Key risks include sector headwinds and any valuation premium. However, the competitive moat and growth trajectory provide meaningful support on the downside.',
  EDUCATIONAL:  'Always remember: every investment carries risk. For {stockName}, watch for market volatility and sector dynamics -- while keeping the strong business fundamentals as your anchor.',
  URGENT:       'Short-term: news-driven volatility can create sharp swings. Medium-term: the underlying fundamentals of {stockName} remain the most important factor to track.',
};

// ============================================================
// CTA templates
// ============================================================

const CTAS: Record<string, string[]> = {
  VIRAL: [
    "Like and follow for daily stock breakdowns! Drop a comment -- are you bullish or bearish on {stockName}? Let's discuss!",
    "Follow for more market-moving updates every single day! Share this with anyone watching {ticker} right now!",
    "Hit follow for more viral stock content! Comment '{ticker}' below if you want a deeper-dive analysis next!",
  ],
  AGGRESSIVE: [
    "Follow for high-conviction stock calls every day! This is one of many setups we track -- don't miss the next one!",
    "Like if you're bullish on {stockName}! Follow for daily momentum trades and breakout alerts!",
    "Want more aggressive stock breakdowns? Follow and hit the bell! Your portfolio will thank you later.",
  ],
  PROFESSIONAL: [
    "Follow for more data-driven stock analysis. Investing decisions should always be supported by research -- subscribe for more.",
    "For more balanced, evidence-based stock coverage, follow this channel. Always do your own due diligence before investing.",
    "Subscribe for weekly fundamental analysis on India's best stocks. Building wealth starts with being well-informed.",
  ],
  EDUCATIONAL: [
    "Found this useful? Follow for more beginner-friendly stock breakdowns every day! Share with a friend learning to invest!",
    "Like for more easy-to-understand market education! The more you learn about investing, the better your financial future.",
    "Save this for later and follow for daily market education! Understanding how markets work is a genuine life skill.",
  ],
  URGENT: [
    "Stay ahead -- follow for real-time market updates and critical stock alerts! Being informed is your biggest advantage.",
    "Like if this was useful! Follow for more urgent market updates -- you never want to be the last to know.",
    "Share this with anyone holding {ticker}! Follow for more time-sensitive market intelligence every single day.",
  ],
};

// ============================================================
// Scene image prompts by sector -- 6 visual contexts each
// ============================================================

const SECTOR_IMAGES: Record<string, string[]> = {
  'Banking & Finance': [
    'modern Indian bank headquarters glass tower at night with glowing financial data on screens, Mumbai skyline, dramatic blue and gold lighting, cinematic atmosphere',
    'close-up of smartphone showing banking app with green profit numbers, NSE ticker data, bokeh city background, professional product photography',
    'Indian bank branch interior with digital screens showing market data, professional lighting, customers in background, sleek modern design',
    'Mumbai financial district aerial view at golden hour, Bandra Kurla Complex skyline, dramatic warm lighting, business district energy',
    'NSE trading terminal screens glowing in dark room showing red and green candlestick charts, dramatic contrast lighting, financial data visualization',
    'Indian businessman reviewing financial documents at modern desk with multiple monitors, professional office setting, focused atmosphere',
  ],
  'IT & Technology': [
    'modern Indian tech campus building at night with glowing blue lights, Bangalore tech hub atmosphere, sleek corporate architecture',
    'close-up of laptop showing software dashboard with analytics data, hands typing code, clean desk setup, natural light from window',
    'young Indian software engineers collaborating in open-plan tech office, multiple screens, energetic startup atmosphere',
    'server room with rows of glowing equipment, blue and purple lighting, data center scale, India cloud computing theme',
    'abstract digital background showing code patterns and rupee symbols floating, dark blue atmosphere, technology concept art',
    'Indian tech professional presenting data visualization on large screen, conference room, professional corporate setting',
  ],
  'Automobile': [
    'sleek modern Indian SUV on dramatic showroom floor, studio spotlights, reflective polished surface, premium automotive photography',
    'automated car manufacturing plant in India with robotic arms welding, dramatic industrial orange and blue lighting',
    'aerial view of Indian expressway with modern vehicles, golden hour lighting, dynamic transportation energy',
    'close-up of luxury car wheel and brake disc on city road, motion blur background, professional automotive detail shot',
    'electric vehicle charging station in modern Indian city, clean green energy aesthetic, futuristic urban setting',
    'car dealership showroom interior with multiple vehicles on display, professional lighting, premium retail atmosphere',
  ],
  'Pharmaceuticals': [
    'state-of-the-art Indian pharmaceutical laboratory with scientists in white coats, clean sterile environment, bright clinical lighting',
    'close-up macro shot of colorful medicine capsules and tablets on clean reflective surface, professional product photography',
    'pharmaceutical manufacturing facility with automated production lines in India, industrial clean room setting',
    'Indian doctor using digital tablet in modern hospital corridor, healthcare technology, professional medical setting',
    'microscope and research equipment in biotech laboratory, scientist analyzing samples, Indian R&D facility',
    'pharmaceutical supply chain logistics hub with labeled packages and automated sorting, efficient modern facility',
  ],
  'FMCG': [
    'premium Indian consumer product range artfully arranged on dark background, dramatic studio lighting, vibrant brand colors',
    'busy modern Indian supermarket aisle with colorful product displays, lifestyle photography, consumer goods',
    'Indian family enjoying branded consumer products at home, warm natural lighting, aspirational lifestyle photography',
    'brand identity and packaging design showcase on clean white surface, professional product photography, FMCG retail',
    'distribution warehouse with stacked branded consumer goods, organized logistics, efficient supply chain India',
    'modern Indian urban retail store interior, well-lit shelves with consumer products, professional commercial photography',
  ],
  'Energy': [
    'massive oil refinery at dramatic Indian sunset, industrial silhouette against orange sky, scale and power',
    'vast solar farm in Rajasthan desert, thousands of panels stretching to horizon, aerial drone perspective, clean energy',
    'wind turbines on Indian west coast at golden hour, clean renewable energy, dramatic ocean backdrop',
    'power plant with cooling towers reflected in still water at dusk, atmospheric lighting, industrial poetry',
    'smart city energy grid visualization over India map, glowing connection lines, technology meets infrastructure',
    'LNG terminal or gas processing facility at night, industrial lighting, energy sector infrastructure India',
  ],
  'Metals & Mining': [
    'steel plant with molten metal pouring from furnace, dramatic red-orange glow, intense industrial atmosphere India',
    'modern automated steel manufacturing facility, massive rolling mill equipment, industrial scale photography',
    'open-cast mining operation in India aerial view, scale of operations, geological landscape',
    'finished steel coils and products in massive warehouse, industrial scale, professional facility photography',
    'commodity trading floor or metals exchange data visualization, screens showing price data, financial trading',
    'construction site using Indian steel products, urban development, infrastructure growth photography',
  ],
  'Real Estate': [
    'luxury Indian residential towers under construction against blue sky, cranes and scaffolding, real estate development',
    'modern apartment complex interior with premium finishes, real estate marketing photography, aspirational living',
    'aerial view of Indian city showing real estate development, urban growth, residential and commercial mix',
    'upscale commercial real estate building exterior, glass and steel facade, corporate real estate photography',
    'real estate developer presentation with building scale model, architectural concept, professional meeting setting',
    'smart home technology in premium Indian apartment, modern interior design, technology and lifestyle',
  ],
  'Telecom': [
    '5G cell tower at sunset with signal wave visualization overlay, Indian telecom infrastructure, technology',
    'close-up of smartphone showing high-speed data visualization, connectivity theme, professional tech photography',
    'young Indian consumers using mobile devices in urban setting, digital lifestyle photography, telecom narrative',
    'fiber optic cables glowing with light, data transmission concept, Indian digital infrastructure theme',
    'telecom operations center with monitoring screens, engineers managing network, professional technical setting',
    'Indian city skyline at night with glowing network connectivity lines overlay, digital India theme',
  ],
  'Infrastructure': [
    'dramatic aerial view of Indian highway interchange under construction, scale of infrastructure project',
    'modern bridge construction in India, engineering achievement, golden hour dramatic lighting',
    'high-speed rail project in India, train passing through landscape, infrastructure development photography',
    'construction workers at major Indian infrastructure project, safety equipment, professional documentary photography',
    'completed modern infrastructure project in India, showcase of engineering, professional photography',
    'smart city infrastructure project aerial view, urban planning, Indian development story',
  ],
  'Cement': [
    'cement plant at dusk with dramatic industrial silhouette, kiln glowing, Indian manufacturing scale',
    'construction site in India with cement being poured, building activity, infrastructure growth',
    'modern cement bags stacked in distribution warehouse, supply chain photography, industrial scale',
    'aerial view of Indian construction boom, multiple sites active simultaneously, economic development',
    'cement manufacturing process close-up, rotating kiln or grinding mill, industrial process photography',
    'urban skyline of growing Indian city, construction cranes everywhere, real estate and cement demand',
  ],
  'Retail': [
    'modern Indian shopping mall interior with premium brand stores, consumer lifestyle photography, retail energy',
    'supermarket with well-organized fresh produce and products, retail operations photography, India',
    'busy Indian retail store with customers shopping, authentic retail environment, consumer behavior',
    'retail logistics and supply chain, delivery vehicles and warehouse, e-commerce and retail India',
    'retail store display with attractive product arrangement, merchandising photography, professional',
    'Indian consumer pulling shopping cart, retail therapy, lifestyle photography, modern retail India',
  ],
  'Stock Market': [
    'Bombay Stock Exchange building exterior at golden hour, iconic BSE dome, Mumbai financial landmark',
    'NSE or BSE trading terminal screens showing red and green market data, dramatic contrast lighting',
    'Indian stock market chart on digital screen trending upward, financial data visualization, professional',
    'Indian investor with multiple trading screens in home office, focused concentration, modern setup',
    'financial newspaper with Indian stock market headlines on professional desk, business photography',
    'Bull statue outside BSE Mumbai, iconic Indian financial market symbol, dramatic lighting',
  ],
};

function getSceneImagePrompt(sector: string, idx: number, stockName: string, tone: string): string {
  const ctxs = SECTOR_IMAGES[sector] ?? SECTOR_IMAGES['Stock Market'];
  const base = ctxs[idx % ctxs.length];
  const mood = tone === 'AGGRESSIVE' || tone === 'URGENT' ? 'dramatic high contrast' : 'cinematic professional';
  return `${base}, ultra realistic photorealistic 8K resolution, ${mood}, vertical portrait 9:16 aspect ratio, no text no watermarks no logos, masterpiece quality, sharp focus, depth of field, professional stock photography`;
}

// ============================================================
// Main: Generate Script -- sync, zero API cost
// ============================================================

export async function generateScript(params: {
  stockName: string;
  ticker: string;
  sector?: string;
  stockData: string;
  positiveNews?: string;
  negativeNews?: string;
  keyNumbers?: string;
  tone: VideoTone;
  style: VideoStyle;
}): Promise<GeneratedScript> {
  const { stockName, ticker, stockData, positiveNews, negativeNews, keyNumbers, tone } = params;

  const positiveInfo = positiveNews?.trim()
    ? positiveNews.trim().slice(0, 200)
    : 'strong growth fundamentals and positive sector momentum';

  const keyHighlight = keyNumbers?.trim()
    ? `the key metrics stand out clearly -- ${keyNumbers.trim().slice(0, 150)}`
    : 'the financial performance is clearly impressive';

  const vars: Record<string, string> = {
    stockName,
    ticker,
    stockData: stockData.trim().slice(0, 300),
    positiveInfo,
    negativeInfo: negativeNews?.trim() || 'some near-term market uncertainty',
    keyHighlight,
    keyNumbers: keyNumbers?.trim() || '',
  };

  const t = (tone in HOOKS) ? tone : 'VIRAL';

  const hook         = fill(pick(HOOKS[t]), vars);
  const mainContent  = fill(pick(BODY[t]), vars);
  const whyItMatters = fill(pick(WHY[t]), vars);
  const riskOpp      = fill(RISK[t] ?? RISK.VIRAL, vars);
  const cta          = fill(pick(CTAS[t]), vars);

  const fullScript = [hook, mainContent, whyItMatters, riskOpp, cta].join(' ');
  const wordCount  = fullScript.split(/\s+/).filter(Boolean).length;

  return {
    hook,
    mainContent,
    whyItMatters,
    keyNumbers: keyNumbers?.trim() ?? '',
    riskOpportunity: riskOpp,
    cta,
    fullScript,
    wordCount,
    estimatedDuration: Math.round(wordCount / 2.5), // ~150 wpm
  };
}

// ============================================================
// Scene generator -- splits script into 8-10 timed scenes
// ============================================================

export async function generateScenes(params: {
  fullScript: string;
  stockName: string;
  ticker: string;
  tone: VideoTone;
  style: VideoStyle;
  sector?: string;
  stockData?: string;
}): Promise<GeneratedScene[]> {
  const { fullScript, stockName, tone, style, stockData } = params;
  const sector = params.sector || detectSector(stockName, stockData ?? '');

  // Split into natural sentence chunks
  const raw = fullScript.match(/[^.!?]+[.!?]+\s*/g) ?? [fullScript];

  // Target 8-10 scenes; merge very short sentences
  const TARGET = 9;
  const groups: string[] = [];
  let buf = '';

  for (const s of raw) {
    buf += s;
    // Flush when buffer has enough words for ~4s of speech
    if (buf.split(/\s+/).length >= Math.floor(fullScript.split(/\s+/).length / TARGET)) {
      groups.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) {
    if (groups.length > 0) {
      groups[groups.length - 1] += ' ' + buf.trim();
    } else {
      groups.push(buf.trim());
    }
  }

  const transitions = ['cut', 'cut', 'fade', 'cut', 'cut', 'fade', 'cut', 'cut', 'fade'];
  const visualStyles: Record<VideoStyle, string> = {
    DYNAMIC:   'high energy fast cut',
    MINIMAL:   'clean minimal aesthetic',
    CINEMATIC: 'cinematic dramatic',
    NEWS:      'broadcast news style',
    HYPE:      'extreme energy viral',
  };
  const vStyle = visualStyles[style] ?? 'cinematic';

  return groups.map((narration, i): GeneratedScene => {
    const words = narration.split(/\s+/).filter(Boolean).length;
    const duration = Math.max(3.5, Math.round(words / 2.5 * 10) / 10);

    // Subtitle: first 8 words, capitalize important ones
    const subtitleWords = narration.split(/\s+/).slice(0, 8);
    const subtitleText = subtitleWords
      .map((w) => (/\b(just|massive|breaking|urgent|now|alert|huge|shocking|critical|biggest)\b/i.test(w) ? w.toUpperCase() : w))
      .join(' ')
      .replace(/[!?.]+$/, '') + (narration.split(/\s+/).length > 8 ? '...' : '');

    return {
      sceneNumber:  i + 1,
      narration,
      subtitleText,
      imagePrompt:  getSceneImagePrompt(sector, i, stockName, tone),
      transition:   i === groups.length - 1 ? 'fade' : transitions[i % transitions.length],
      visualStyle:  vStyle,
      duration,
    };
  });
}

// ============================================================
// SEO generator -- zero API cost
// ============================================================

export async function generateSEO(params: {
  stockName: string;
  ticker: string;
  sector?: string;
  script?: string;
  tone: VideoTone;
  keyHighlights?: string;
}): Promise<GeneratedSEO> {
  const { stockName, ticker, tone, keyHighlights } = params;
  const sector = params.sector || detectSector(stockName, params.script ?? '');

  const titleMap: Record<string, string[]> = {
    VIRAL:        [`${stockName} Just Made This SHOCKING Move! 🔥 #Shorts`, `Everyone's Talking About ${stockName} ${ticker} -- Here's Why! #Shorts`, `${stockName} Is Going VIRAL Right Now! Full Breakdown #Shorts`],
    AGGRESSIVE:   [`${stockName} BREAKOUT! 🚀 Full Analysis #Shorts`, `${stockName} ${ticker} MASSIVE Move -- Buy or Sell? #Shorts`, `${stockName} Bulls Taking CONTROL! #Shorts`],
    PROFESSIONAL: [`${stockName} Analysis: Key Metrics & Outlook #Shorts`, `Is ${stockName} (${ticker}) Worth Buying? Honest Analysis #Shorts`, `${stockName} Investment Case: The Full Picture #Shorts`],
    EDUCATIONAL:  [`${stockName} Explained in 60 Seconds! 📚 #Shorts`, `What Is ${stockName}? Beginner's Complete Guide #Shorts`, `Understanding ${stockName} ${ticker} -- Made Simple! #Shorts`],
    URGENT:       [`URGENT: ${stockName} Alert! ⚡ Watch Now #Shorts`, `BREAKING: ${stockName} News You MUST Know! #Shorts`, `${stockName} Critical Update -- Before Market Opens! #Shorts`],
  };

  const t = (tone in titleMap) ? tone : 'VIRAL';
  const title = pick(titleMap[t]);

  const highlights = keyHighlights || `Everything investors need to know about ${stockName} including performance data, key metrics, and market outlook.`;

  const description = `📊 ${stockName} (${ticker}) -- Complete Stock Analysis

${highlights}

🎯 In this video:
• ${stockName} latest performance overview
• Key financial metrics and data points
• Why the market is paying attention to ${ticker}
• Investment perspective & what to watch next

⚠️ Disclaimer: This content is for educational and informational purposes only. It is not financial advice. Always conduct your own research and consult a qualified financial advisor before making any investment decisions.

🔔 Follow for daily Indian stock market analysis and breakdowns!

#${ticker} #${stockName.replace(/\s+/g, '')} #IndianStockMarket #NSE #BSE #Shorts`;

  const hashtags = [
    `#${ticker}`,
    `#${stockName.replace(/\s+/g, '')}`,
    '#IndianStockMarket',
    '#NSE',
    '#BSE',
    '#Shorts',
    '#StockMarket',
    '#Investing',
    '#StockAnalysis',
    '#DalalStreet',
    '#Nifty50',
    '#Sensex',
    '#ShareMarket',
    '#IndiaStocks',
    '#TradingTips',
  ];

  const tags = [
    stockName,
    ticker,
    `${stockName} stock`,
    `${ticker} share price`,
    `${ticker} analysis`,
    'Indian stock market',
    'NSE stocks today',
    'BSE stocks',
    'stock market India',
    'Indian stocks to buy',
    'Nifty 50 stocks',
    'Sensex today',
    sector,
    'stock analysis India',
    'share market India',
    'best stocks India',
    'stock market shorts',
    'Indian investing',
    'Dalal Street',
    'SEBI stocks',
  ];

  return { title, description, hashtags, tags, category: '22' };
}
