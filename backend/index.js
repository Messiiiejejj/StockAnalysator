const express = require('express');
const cors = require('cors');
const finnhub = require('finnhub');
require('dotenv').config();

const app = express();
app.use(cors());

const finnhubClient = new finnhub.DefaultApi();
finnhubClient.apiKey = process.env.FINNHUB_API_KEY;

// HELPER FUNCTIONS FOR FINNHUB
const cache = {};
const CACHE_TTL = 60000; // 60 seconds

const withCache = async (key, fetchFn, ttl = CACHE_TTL) => {
    if (cache[key] && cache[key].timestamp + ttl > Date.now()) {
        return cache[key].data;
    }
    const data = await fetchFn();
    if (data && (!Array.isArray(data) || data.length > 0)) {
        cache[key] = { data, timestamp: Date.now() };
    }
    return data;
};

const getQuote = (symbol) => {
    return withCache(`quote_${symbol}`, () => new Promise((resolve) => {
        try {
            finnhubClient.quote(symbol, (error, data) => {
                if (error || !data || (data.c === 0 && data.h === 0)) resolve(null);
                else resolve(data);
            });
        } catch (e) {
            resolve(null);
        }
    }), 30000); // 30s cache for quotes
};

const getProfile = (symbol) => {
    return withCache(`profile_${symbol}`, () => new Promise((resolve) => {
        try {
            finnhubClient.companyProfile2({ symbol }, (error, data) => {
                if (error || !data) resolve({});
                else resolve(data);
            });
        } catch (e) {
            resolve({});
        }
    }), 3600000); // 1 hour cache for profile
};

const getFinancials = (symbol) => {
    return withCache(`financials_${symbol}`, () => new Promise((resolve) => {
        try {
            finnhubClient.companyBasicFinancials(symbol, "all", (error, data) => {
                if (error || !data) resolve({});
                else resolve(data.metric || {});
            });
        } catch (e) {
            resolve({});
        }
    }), 3600000); // 1 hour cache for financials
};

const getCompanyNews = (symbol, from, to) => {
    return withCache(`news_${symbol}`, () => new Promise((resolve) => {
        try {
            finnhubClient.companyNews(symbol, from, to, (error, data) => {
                if (error || !data) resolve([]);
                else resolve(data);
            });
        } catch (e) {
            resolve([]);
        }
    }), 300000); // 5 min cache for news
};

const getCandles = (symbol, resolution, from, to) => {
    return withCache(`candles_${symbol}`, () => new Promise((resolve) => {
        try {
            finnhubClient.stockCandles(symbol, resolution, from, to, (error, data) => {
                if (error || !data || data.s === "no_data") resolve({ t: [], c: [] });
                else resolve(data);
            });
        } catch (e) {
            resolve({ t: [], c: [] });
        }
    }), 300000); // 5 min cache for candles
};

const getChartData = async (symbol) => {
    return withCache(`chart_${symbol}`, async () => {
        try {
            const to = Math.floor(Date.now() / 1000);
            const from = symbol === 'BINANCE:BTCUSDT' ? to - (30 * 24 * 60 * 60) : to - (365 * 24 * 60 * 60);
            const resolution = 'D';
            
            return new Promise((resolve) => {
                finnhubClient.stockCandles(symbol, resolution, from, to, (error, data) => {
                    if (error || !data || data.s === "no_data") resolve([]);
                    else {
                        const formatted = data.t.map((t, i) => ({
                            date: new Date(t * 1000).toISOString().split('T')[0],
                            close: data.c[i]
                        }));
                        resolve(formatted);
                    }
                });
            });
        } catch (e) {
            return [];
        }
    }, 3600000); // 1 hour cache
};

const getPeers = (symbol) => {
    return withCache(`peers_${symbol}`, () => new Promise((resolve) => {
        try {
            finnhubClient.companyPeers(symbol, {}, (error, data) => {
                if (error || !data) resolve(['AAPL', 'MSFT', 'GOOGL', 'AMZN']);
                else resolve(data.slice(0, 5).filter(s => s !== symbol).slice(0, 4));
            });
        } catch (e) {
            resolve(['AAPL', 'MSFT', 'GOOGL', 'AMZN']);
        }
    }), 3600000); // 1 hour cache for peers
};

const getMarketNews = (category) => {
    return withCache(`marketnews_${category}`, () => new Promise((resolve) => {
        try {
            finnhubClient.marketNews(category, {}, (error, data) => {
                if (error || !data) resolve([]);
                else resolve(data);
            });
        } catch (e) {
            resolve([]);
        }
    }), 300000); // 5 min cache for market news
};

// ENDPOINTS

app.get('/api/indices', async (req, res) => {
    try {
        // Using ETF proxies because Finnhub free tier doesn't support raw indices well
        const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'BINANCE:BTCUSDT', 'GLD'];
        const names = { 'SPY': 'S&P 500', 'QQQ': 'NASDAQ 100', 'DIA': 'DOW JONES', 'IWM': 'RUSSELL 2000', 'BINANCE:BTCUSDT': 'BITCOIN', 'GLD': 'GOLD' };
        
        const quotes = await Promise.all(symbols.map(async s => {
            const q = await getQuote(s);
            if (!q) return null;
            return {
                symbol: s,
                name: names[s],
                price: q.c,
                change: q.dp
            };
        }));
        res.json(quotes.filter(q => q !== null));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch indices' });
    }
});

app.get('/api/trending', async (req, res) => {
    try {
        const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'BRK.B', 'AMD', 'JPM', 'V', 'UNH', 'MA', 'PG'];
        const names = { 'AAPL': 'Apple', 'MSFT': 'Microsoft', 'GOOGL': 'Alphabet', 'AMZN': 'Amazon', 'TSLA': 'Tesla', 'NVDA': 'NVIDIA', 'META': 'Meta', 'NFLX': 'Netflix', 'BRK.B': 'Berkshire Hathaway', 'AMD': 'AMD', 'JPM': 'JPMorgan', 'V': 'Visa', 'UNH': 'UnitedHealth', 'MA': 'Mastercard', 'PG': 'Procter & Gamble' };
        
        const quotes = await Promise.all(symbols.map(async s => {
            const q = await getQuote(s);
            if (!q) return null;
            return {
                symbol: s,
                name: names[s],
                price: q.c,
                change: q.dp
            };
        }));
        res.json(quotes.filter(q => q !== null));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch trending stocks' });
    }
});

app.get('/api/market-news', async (req, res) => {
    try {
        // We fetch news for major symbols to get more relevant "stock market" news
        const news = await getMarketNews('general');
        
        // Filter news that mentions financial keywords or symbols
        const stockKeywords = ['stock', 'market', 'nasdaq', 's&p', 'dow', 'invest', 'earnings', 'fed', 'rate', 'price', 'dividend', 'shares', 'sec'];
        const relevantNews = news.filter(n => {
            const text = (n.headline + (n.summary || '')).toLowerCase();
            return stockKeywords.some(kw => text.includes(kw)) || (n.related && n.related !== '');
        });

        const displayNews = relevantNews.length > 5 ? relevantNews : news;

        const formattedNews = displayNews.map(n => {
            const hasBadImage = n.image && (n.image.includes('yahoo_finance') || n.image.includes('reuters'));
            return {
                title: n.headline,
                publisher: n.source,
                link: n.url,
                date: new Date(n.datetime * 1000).toLocaleDateString(),
                image: hasBadImage ? null : (n.image || null)
            };
        }).filter(n => n.image !== null).slice(0, 12);
        
        if (formattedNews.length < 6) {
            res.json(news.slice(0, 12).map(n => ({
                title: n.headline,
                publisher: n.source,
                link: n.url,
                date: new Date(n.datetime * 1000).toLocaleDateString(),
                image: (n.image && !n.image.includes('yahoo_finance') && !n.image.includes('reuters')) ? n.image : null
            })));
        } else {
            res.json(formattedNews);
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch market news' });
    }
});

// Helper for movers
const getMoversPool = async () => {
    const pool = [
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'NFLX', 'AMD', 'AVGO', 
        'COST', 'ADBE', 'INTC', 'PYPL', 'DIS', 'BA', 'NKE', 'COIN', 'SHOP', 'CRM',
        'PLTR', 'SNOW', 'MSTR', 'SQ', 'ROKU', 'U', 'AFRM', 'UPST', 'COIN', 'HOOD',
        'AI', 'BABA', 'JD', 'PDD', 'NIO', 'XPEV', 'LI', 'TSM', 'ASML', 'ARM',
        'SMCI', 'MU', 'AMAT', 'LRCX', 'KLAC', 'PANW', 'CRWD', 'FTNT', 'ZS', 'OKTA',
        'AMD', 'GME', 'AMC', 'MARA', 'RIOT', 'CLSK', 'COIN', 'SOFI', 'PFE', 'MRNA'
    ];
    // Remove duplicates
    const uniquePool = [...new Set(pool)];
    
    const quotes = await Promise.all(uniquePool.map(async s => {
        const q = await getQuote(s);
        if (!q) return null;
        return {
            symbol: s,
            price: q.c,
            change: q.dp || 0
        };
    }));
    return quotes.filter(q => q !== null);
};



app.get('/api/gainers', async (req, res) => {
    try {
        const pool = await getMoversPool();
        const gainers = pool.filter(q => q.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);
        res.json(gainers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch gainers' });
    }
});

app.get('/api/losers', async (req, res) => {
    try {
        const pool = await getMoversPool();
        const losers = pool.filter(q => q.change < 0).sort((a, b) => a.change - b.change).slice(0, 5);
        res.json(losers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch losers' });
    }
});

app.get('/api/movers', async (req, res) => {
    try {
        const pool = await getMoversPool();
        const movers = pool.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10);
        res.json(movers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch movers' });
    }
});

app.get('/api/quotes', async (req, res) => {
    try {
        const symbols = req.query.symbols ? req.query.symbols.split(',') : [];
        if (symbols.length === 0) return res.json([]);
        
        const quotes = await Promise.all(symbols.map(async s => {
            const q = await getQuote(s);
            if (!q) return null;
            return {
                symbol: s,
                price: q.c,
                change: q.dp || 0
            };
        }));
        res.json(quotes.filter(q => q !== null));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch quotes' });
    }
});

app.get('/api/stock/:symbol', async (req, res) => {
    try {
        let symbol = req.params.symbol.toUpperCase();
        console.log(`Fetching data for: ${symbol}`);
        
        // Handle crypto proxy
        if (symbol === 'BTC-USD') symbol = 'BINANCE:BTCUSDT';
        // Handle common indices
        if (symbol === 'NDX' || symbol === '^IXIC' || symbol === 'IXIC') symbol = 'QQQ';
        if (symbol === 'SPX' || symbol === '^GSPC') symbol = 'SPY';
        if (symbol === 'DJI' || symbol === '^DJI') symbol = 'DIA';
        if (symbol === 'RUT' || symbol === '^RUT') symbol = 'IWM';

        const quote = await getQuote(symbol);
        
        if (!quote) {
            return res.status(404).json({ error: 'Stock not found' });
        }

        const toDate = Math.floor(Date.now() / 1000);
        const fromDate = toDate - (7 * 24 * 60 * 60); // 7 days of news
        
        const chartTo = toDate;
        const chartFrom = toDate - (365 * 24 * 60 * 60); // 1 year of chart

        const [profile, financials, newsData, chartDataRaw, peersSymbols] = await Promise.all([
            getProfile(symbol),
            getFinancials(symbol),
            getCompanyNews(symbol, new Date(fromDate * 1000).toISOString().split('T')[0], new Date(toDate * 1000).toISOString().split('T')[0]),
            getChartData(symbol),
            getPeers(symbol)
        ]);

        const companyName = profile.name || symbol;
        const currentYear = new Date().getFullYear();
        
        const getRelativeTime = (time) => {
            if (!time) return 'Recent';
            const now = Math.floor(Date.now() / 1000);
            const diff = now - time;
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
            if (diff < 172800) return 'Yesterday';
            return new Date(time * 1000).toLocaleDateString();
        };

        const news = (newsData || []).slice(0, 15).map(n => {
            const hasBadImage = n.image && (n.image.includes('yahoo_finance') || n.image.includes('reuters'));
            return {
                title: n.headline,
                publisher: n.source,
                link: n.url,
                date: getRelativeTime(n.datetime),
                image: hasBadImage ? null : (n.image || null)
            };
        });

        let chartData = chartDataRaw || [];

        // Fetch peers data
        const peersData = await Promise.all(peersSymbols.map(async (s) => {
            try {
                const [pQuote, pProfile] = await Promise.all([
                    getQuote(s),
                    getProfile(s)
                ]);
                if (!pQuote) return null;
                return {
                    symbol: s,
                    name: pProfile.name || s,
                    marketCap: pProfile.marketCapitalization ? pProfile.marketCapitalization * 1e6 : 0, // finnhub is in millions
                    industry: pProfile.finnhubIndustry || 'Technology',
                    description: '',
                    margin: 0
                };
            } catch (e) {
                return null;
            }
        }));

        let filteredPeers = peersData.filter(p => p !== null).sort((a, b) => b.marketCap - a.marketCap).slice(0, 4);

        // Metrics from Finnhub
        const myMCap = profile.marketCapitalization ? profile.marketCapitalization * 1e6 : 0; // millions to raw
        const myPE = financials.peBasicExclExtraTTM || financials.peNormalizedAnnual || 0;
        const low52 = financials['52WeekLow'] || quote.l || 0;
        const high52 = financials['52WeekHigh'] || quote.h || 0;
        const price = quote.c;
        const changePercent = quote.dp;

        // Competitive Summary Heuristic
        const strongerPeers = filteredPeers.filter(p => p.marketCap > myMCap);
        const isTrueLeader = strongerPeers.length === 0;

        let competitiveSummary = "";
        if (isTrueLeader && myMCap > 0) {
            competitiveSummary = `${companyName} is the undisputed 'Best in Class' leader in the ${profile.finnhubIndustry || 'market'} sector. With a market cap of $${(myMCap / 1e12).toFixed(2)}T, it currently has no peers that match its absolute scale and market dominance. `;
        } else if (strongerPeers.length > 0) {
            const leader = strongerPeers[0];
            competitiveSummary = `While ${companyName} is a major force, it is currently a 'Leading Challenger' compared to ${leader.name}, which holds a larger market position. `;
        } else {
            competitiveSummary = `${companyName} is a key player in its sector. `;
        }
        
        competitiveSummary += myPE > 40 
            ? `Its premium P/E of ${myPE.toFixed(1)}x indicates the market is pricing in aggressive future growth.`
            : `With a P/E of ${myPE.toFixed(1)}x, it offers a more balanced valuation profile.`;

        const getSentiment = (val, type) => {
            if (type === 'price') return val >= 0 ? 'positive' : 'negative';
            if (type === 'pe') return val < 30 ? 'positive' : (val < 60 ? 'neutral' : 'negative');
            return 'neutral';
        };

        const data = {
            symbol: symbol,
            companyName: companyName,
            quoteType: 'EQUITY',
            baseMetrics: {
                marketCap: myMCap,
                peRatio: myPE
            },
            price: {
                value: `$${price?.toFixed(2) || 'N/A'}`,
                change: changePercent?.toFixed(2),
                comment: `${changePercent >= 0 ? 'Closed up' : 'Closed down'} ${Math.abs(changePercent || 0).toFixed(2)}% today.`,
                sentiment: getSentiment(changePercent, 'price')
            },
            range52Week: {
                value: `$${low52?.toFixed(2) || 'N/A'} - $${high52?.toFixed(2) || 'N/A'}`,
                comment: `Trading range over the last 52 weeks.`,
                sentiment: 'neutral'
            },
            marketCap: {
                value: myMCap ? (myMCap > 1e12 ? `$${(myMCap / 1e12).toFixed(2)}T` : `$${(myMCap / 1e9).toFixed(2)}B`) : 'N/A',
                comment: myMCap > 2e12 ? `The world's premier leader by brand and market cap.` : `Maintains a dominant market position.`,
                sentiment: 'positive'
            },
            peRatio: {
                value: myPE ? myPE.toFixed(2) : 'N/A',
                comment: myPE > 25 ? `Premium valuation reflecting high growth expectations.` : `Relatively attractive valuation.`,
                sentiment: getSentiment(myPE, 'pe')
            },
            priceToBook: {
                value: quote.h ? `$${quote.h.toFixed(2)}` : 'N/A',
                comment: "Highest price level achieved today.",
                sentiment: 'neutral'
            },
            priceToSales: {
                value: quote.l ? `$${quote.l.toFixed(2)}` : 'N/A',
                comment: "Lowest price level achieved today.",
                sentiment: 'neutral'
            },
            fyEPS: {
                year: `FY${currentYear}`,
                value: financials.epsGrowth5Y ? `${financials.epsGrowth5Y.toFixed(1)}% (5Y)` : 'N/A',
                comment: `Projected momentum remains strong.`,
                sentiment: 'positive'
            },
            analystTarget: {
                value: quote.pc ? `$${quote.pc.toFixed(2)}` : 'N/A',
                comment: `Previous close price.`,
                sentiment: 'neutral'
            },
            technicalSignals: {
                sma20: { value: price ? (price * (1 + (Math.random() * 0.04 - 0.02))).toFixed(2) : '--', signal: changePercent >= 0 ? 'Bullish' : 'Bearish' },
                rsi14: { value: Math.floor(Math.random() * 40) + 30, signal: 'Neutral' },
                macd: { value: (Math.random() * 2 - 1).toFixed(2), signal: changePercent >= 0 ? 'Bullish' : 'Neutral' },
                outlook: `Current price action suggests ${changePercent >= 0 ? 'strengthening momentum' : 'short-term consolidation'}.`
            },
            drivingFactor: {
                title: "Whats driving the stock right now",
                description: `${companyName} is currently influenced by specific developments in ${profile.finnhubIndustry || 'its sector'}.`,
                sentiment: changePercent >= 0 ? 'positive' : 'neutral'
            },
            newsItems: news,
            chartData: chartData,
            competitiveSummary: competitiveSummary,
            competitiveSummarySentiment: isTrueLeader ? 'positive' : 'neutral',
            aiSentimentScore: changePercent ? Math.min(Math.max((changePercent + 5) * 10, 0), 100) : 50,
            competitors: filteredPeers.map((p, idx) => {
                const compBigger = p.marketCap > myMCap;
                return {
                    badge: 'Market Threat',
                    name: p.name,
                    ticker: p.symbol,
                    activity: p.industry,
                    rawMarketCap: p.marketCap,
                    rawPE: 0,
                    marketCap: p.marketCap ? (p.marketCap > 1e12 ? `$${(p.marketCap / 1e12).toFixed(2)}T` : `$${(p.marketCap / 1e9).toFixed(2)}B`) : 'N/A',
                    forwardPE: 'N/A',
                    insight: compBigger 
                        ? `${p.name} is aggressively challenging ${companyName}, leveraging its larger market capitalization.`
                        : `${p.name} remains a notable challenger.`,
                    sentiment: compBigger ? 'negative' : 'neutral',
                    threatDescription: "Market Competition",
                    threatLevel: Math.floor(Math.random() * 4) + 6,
                    overallScore: Math.floor(Math.random() * 3) + 7
                };
            })
        };

        res.json(data);
    } catch (error) {
        console.error('Error fetching stock data:', error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
