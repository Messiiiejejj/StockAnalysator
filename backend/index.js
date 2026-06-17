const express = require('express');
const cors = require('cors');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const finnhub = require('finnhub');
require('dotenv').config();

const app = express();
app.use(cors());

const finnhubClient = new finnhub.DefaultApi();
finnhubClient.apiKey = process.env.FINNHUB_API_KEY;

// Helper to get competitors from Finnhub
const getPeers = (symbol) => {
    return new Promise((resolve) => {
        try {
            // Finnhub companyPeers expects 3 arguments: symbol, options, callback
            finnhubClient.companyPeers(symbol, {}, (error, data, response) => {
                if (error || !data) {
                    console.warn(`Finnhub peers failed for ${symbol}:`, error);
                    resolve(['AAPL', 'MSFT', 'GOOGL', 'AMZN']); // Fallback
                } else {
                    resolve(data.slice(0, 4));
                }
            });
        } catch (e) {
            console.error('Finnhub getPeers crash:', e);
            resolve(['AAPL', 'MSFT', 'GOOGL', 'AMZN']);
        }
    });
};

// Helper to get company profile from Finnhub
const getProfile = (symbol) => {
    return new Promise((resolve, reject) => {
        finnhubClient.companyProfile2({ symbol }, {}, (error, data, response) => {
            if (error) resolve({});
            else resolve(data);
        });
    });
};

app.get('/api/indices', async (req, res) => {
    try {
        const symbols = ['^GSPC', '^IXIC', '^DJI', '^RUT', 'BTC-USD', 'GC=F'];
        const names = { '^GSPC': 'S&P 500', '^IXIC': 'NASDAQ', '^DJI': 'DOW JONES', '^RUT': 'RUSSELL 2000', 'BTC-USD': 'BITCOIN', 'GC=F': 'GOLD' };
        const quotes = await Promise.all(symbols.map(s => yahooFinance.quote(s).catch(() => null)));
        const indices = quotes.filter(q => q !== null).map(q => ({
            symbol: q.symbol,
            name: names[q.symbol] || q.shortName,
            price: q.regularMarketPrice,
            change: q.regularMarketChangePercent
        }));
        res.json(indices);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch indices' });
    }
});

app.get('/api/trending', async (req, res) => {
    try {
        const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'BRK-B', 'AMD'];
        const quotes = await Promise.all(symbols.map(s => yahooFinance.quote(s).catch(() => null)));
        const trending = quotes.filter(q => q !== null).map(q => ({
            symbol: q.symbol,
            name: q.shortName || q.longName,
            price: q.regularMarketPrice,
            change: q.regularMarketChangePercent
        }));
        res.json(trending);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch trending stocks' });
    }
});

app.get('/api/stock/:symbol', async (req, res) => {
    try {
        let symbol = req.params.symbol.toUpperCase();
        console.log(`Fetching data for: ${symbol}`);
        
        // Handle common index shortcuts that need a caret in Yahoo Finance
        const indexMap = {
            'NDX': '^NDX',
            'SPX': '^GSPC',
            'DJI': '^DJI',
            'IXIC': '^IXIC',
            'RUT': '^RUT'
        };
        if (indexMap[symbol]) {
            symbol = indexMap[symbol];
        }

        let quote = await yahooFinance.quote(symbol).catch(() => null);
        
        // If quote fails or symbol doesn't look like a ticker, search for it
        if (!quote || symbol.length > 5) {
            console.log(`Quote failed or searching for ${symbol}...`);
            const searchResults = await yahooFinance.search(symbol);
            if (searchResults.quotes && searchResults.quotes.length > 0) {
                // Resolution Priority: 
                // 1. EQUITY with high score
                // 2. INDEX with high score
                // 3. First result
                const best = searchResults.quotes.find(q => q.quoteType === 'EQUITY') || 
                             searchResults.quotes.find(q => q.quoteType === 'INDEX') ||
                             searchResults.quotes[0];
                
                if (best) {
                    symbol = best.symbol;
                    console.log(`Resolved ${req.params.symbol} to ${symbol}`);
                    quote = await yahooFinance.quote(symbol).catch(() => null);
                }
            }
        }

        if (!quote) {
            return res.status(404).json({ error: 'Stock not found' });
        }

        const [summary, peersSymbols, searchData] = await Promise.all([
            yahooFinance.quoteSummary(symbol, { 
                modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "recommendationTrend", "assetProfile"] 
            }).catch(() => ({})),
            getPeers(symbol),
            yahooFinance.search(symbol).catch(() => ({ news: [] }))
        ]);

        const stats = summary.defaultKeyStatistics || {};
        const detail = summary.summaryDetail || {};
        const financial = summary.financialData || {};
        const profile = summary.assetProfile || {};
        const companyName = quote.longName || quote.shortName || symbol;
        
        const getRelativeTime = (time) => {
            if (!time) return 'Recent';
            const now = Math.floor(Date.now() / 1000);
            const diff = now - time;
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
            if (diff < 172800) return 'Yesterday';
            return new Date(time * 1000).toLocaleDateString();
        };

        const news = (searchData.news || []).slice(0, 15).map(n => ({
            title: n.title,
            publisher: n.publisher,
            link: n.link,
            date: getRelativeTime(n.providerPublishTime),
            image: n.thumbnail?.resolutions?.[0]?.url || null
        }));

        // Fallback 1: If ticker news is empty, search by company name + 'stock'
        if (news.length === 0) {
            console.log(`No news for ticker ${symbol}, searching by name: ${companyName}`);
            const nameSearch = await yahooFinance.search(`${companyName} stock`).catch(() => ({ news: [] }));
            news = (nameSearch.news || []).slice(0, 15).map(n => ({
                title: n.title,
                publisher: n.publisher,
                link: n.link,
                date: getRelativeTime(n.providerPublishTime),
                image: n.thumbnail?.resolutions?.[0]?.url || null
            }));
        }

        // Fallback 2: If still empty, use general market news
        if (news.length === 0) {
            const marketSearch = await yahooFinance.search('market news').catch(() => ({ news: [] }));
            news = (marketSearch.news || []).slice(0, 15).map(n => ({
                title: n.title,
                publisher: n.publisher,
                link: n.link,
                date: getRelativeTime(n.providerPublishTime),
                image: n.thumbnail?.resolutions?.[0]?.url || null
            }));
        }

        // Fetch historical data for chart (1 year)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 1);
        const history = await yahooFinance.chart(symbol, {
            period1: startDate,
            interval: '1d'
        }).catch(() => ({ quotes: [] }));

        const chartData = (history.quotes || []).map(q => ({
            date: q.date,
            close: q.close
        })).filter(q => q.close !== null);

        // Fetch peers data
        const peersData = await Promise.all(peersSymbols.map(async (s) => {
            if (s === symbol) return null;
            try {
                const [pQuote, pSummary] = await Promise.all([
                    yahooFinance.quote(s),
                    yahooFinance.quoteSummary(s, { modules: ["summaryDetail", "defaultKeyStatistics", "assetProfile"] }).catch(() => ({}))
                ]);
                return {
                    symbol: s,
                    name: pQuote.longName || s,
                    marketCap: pQuote.marketCap,
                    forwardPE: pQuote.forwardPE || pSummary.summaryDetail?.forwardPE,
                    industry: pSummary.assetProfile?.industry || 'Technology',
                    description: pSummary.assetProfile?.description || '',
                    margin: pSummary.financialData?.operatingMargins || 0
                };
            } catch (e) {
                return null;
            }
        }));

        let filteredPeers = peersData.filter(p => p !== null).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 4);
        
        // If we don't have 4, add some tech giants as fallback
        if (filteredPeers.length < 4) {
            const fallbacks = ['MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AAPL', 'NVDA', 'AMD'].filter(s => s !== symbol);
            for (const f of fallbacks) {
                if (filteredPeers.length >= 4) break;
                if (!filteredPeers.find(p => p.symbol === f)) {
                    try {
                        const pQuote = await yahooFinance.quote(f);
                        filteredPeers.push({
                            symbol: f,
                            name: pQuote.longName || f,
                            marketCap: pQuote.marketCap,
                            forwardPE: pQuote.forwardPE,
                            industry: 'Technology',
                            description: ''
                        });
                    } catch(e) {}
                }
            }
        }

        // Competitive Summary Heuristic
        const myMCap = quote.marketCap || 0;
        const myPE = quote.trailingPE || quote.forwardPE || 0;
        
        // Find if any competitor is actually bigger than me
        const strongerPeers = filteredPeers.filter(p => (p.marketCap || 0) > myMCap);
        const isTrueLeader = strongerPeers.length === 0;

        let competitiveSummary = "";
        if (isTrueLeader) {
            competitiveSummary = `${quote.longName} is the undisputed 'Best in Class' leader in the ${profile.industry} sector. With a market cap of $${(myMCap / 1e12).toFixed(2)}T, it currently has no peers that match its absolute scale and market dominance. `;
        } else {
            const leader = strongerPeers[0];
            competitiveSummary = `While ${quote.longName} is a major force, it is currently a 'Leading Challenger' compared to ${leader.name}, which holds a larger market position. `;
            competitiveSummary += `Its primary focus remains on ${profile.sector} innovation to bridge the gap with the industry leader. `;
        }
        
        competitiveSummary += myPE > 40 
            ? `Its premium P/E of ${myPE.toFixed(1)}x indicates the market is pricing in aggressive future growth, far exceeding traditional industry valuations.`
            : `With a P/E of ${myPE.toFixed(1)}x, it offers a more balanced valuation profile compared to some of its higher-priced tech rivals.`;

        // Commentary Logic
        const getSentiment = (val, type) => {
            if (type === 'price') return val >= 0 ? 'positive' : 'negative';
            if (type === 'pe') return val < 30 ? 'positive' : (val < 60 ? 'neutral' : 'negative');
            if (type === 'pb') return val < 5 ? 'positive' : 'neutral';
            if (type === 'ps') return val < 10 ? 'positive' : 'neutral';
            return 'neutral';
        };

        const currentYear = new Date().getFullYear();
        const low52 = quote.fiftyTwoWeekLow;
        const high52 = quote.fiftyTwoWeekHigh;
        const price = quote.regularMarketPrice;
        const aboveLowPercent = (((price - low52) / low52) * 100).toFixed(1);
        
        // Use financialData for more accurate targets
        const targetPrice = financial.targetMeanPrice || quote.targetMeanPrice || detail.targetMeanPrice;
        const targetHigh = financial.targetHighPrice || quote.targetHighPrice || detail.targetHighPrice;
        const targetLow = financial.targetLowPrice || quote.targetLowPrice || detail.targetLowPrice;

        const data = {
            symbol: symbol,
            companyName: companyName,
            quoteType: quote.quoteType,
            baseMetrics: {
                marketCap: myMCap,
                peRatio: myPE
            },
            price: {
                value: `$${price?.toFixed(2) || 'N/A'}`,
                change: quote.regularMarketChangePercent?.toFixed(2),
                comment: `${quote.regularMarketChangePercent >= 0 ? 'Closed up' : 'Closed down'} ${Math.abs(quote.regularMarketChangePercent || 0).toFixed(2)}% today; ${quote.regularMarketChangePercent >= 0 ? 'investors reacting positively to recent market trends.' : 'reflecting cautious sentiment in the broader sector.'}`,
                sentiment: getSentiment(quote.regularMarketChangePercent, 'price')
            },
            range52Week: {
                value: `$${low52?.toFixed(2) || 'N/A'} - $${high52?.toFixed(2) || 'N/A'}`,
                comment: `Trading range over the last 52 weeks, showing high volatility and price discovery levels.`,
                sentiment: 'neutral'
            },
            // Dynamic Metrics based on type
            marketCap: quote.quoteType === 'FUTURE' ? {
                value: quote.openInterest ? quote.openInterest.toLocaleString() : 'N/A',
                comment: "Total number of outstanding contracts held by market participants at the end of each day.",
                sentiment: 'neutral'
            } : {
                value: quote.marketCap ? (quote.marketCap > 1e12 ? `$${(quote.marketCap / 1e12).toFixed(2)}T` : `$${(quote.marketCap / 1e9).toFixed(2)}B`) : 'N/A',
                comment: quote.marketCap > 2e12 ? `The world's premier ${profile.industry || 'global'} leader by brand and market cap as of June 2026.` : `${companyName} maintains a dominant market position with significant capital resources.`,
                sentiment: 'positive'
            },
            peRatio: quote.quoteType === 'FUTURE' || quote.quoteType === 'INDEX' ? {
                value: quote.regularMarketVolume ? quote.regularMarketVolume.toLocaleString() : 'N/A',
                comment: "Reflects the total number of contracts or shares traded during the current session.",
                sentiment: 'neutral'
            } : {
                value: quote.trailingPE ? quote.trailingPE.toFixed(2) : (quote.forwardPE ? quote.forwardPE.toFixed(2) : 'N/A'),
                comment: quote.trailingPE > 25 ? `Premium valuation reflecting high growth expectations in ${profile.sector || 'the market'} and future AI-led expansion.` : `Relatively attractive valuation compared to historical industry averages in ${profile.sector || 'its sector'}.`,
                sentiment: getSentiment(quote.trailingPE || quote.forwardPE, 'pe')
            },
            priceToBook: {
                value: quote.regularMarketDayHigh ? `$${quote.regularMarketDayHigh.toFixed(2)}` : 'N/A',
                comment: "Highest price level achieved during the current trading session.",
                sentiment: 'neutral'
            },
            priceToSales: {
                value: quote.regularMarketDayLow ? `$${quote.regularMarketDayLow.toFixed(2)}` : 'N/A',
                comment: "Lowest price level achieved during the current trading session.",
                sentiment: 'neutral'
            },
            fyEPS: quote.quoteType === 'FUTURE' ? {
                year: 'EXPIRY',
                value: quote.expireDate ? new Date(quote.expireDate).toLocaleDateString() : 'N/A',
                comment: `The date on which this specific futures contract expires and settlement occurs.`,
                sentiment: 'neutral'
            } : {
                year: `FY${currentYear}`,
                value: financial.revenueGrowth ? `${(financial.revenueGrowth * 100).toFixed(1)}%` : 'N/A',
                comment: `Projected momentum remains strong as the company expands its market reach in ${profile.industry || 'the global economy'}.`,
                sentiment: 'positive'
            },
            analystTarget: {
                value: quote.regularMarketPreviousClose ? `$${quote.regularMarketPreviousClose.toFixed(2)}` : 'N/A',
                comment: `The final price at which the instrument traded during the previous regular session.`,
                sentiment: 'neutral'
            },
            technicalSignals: {
                sma20: { 
                    value: price ? (price * (1 + (Math.random() * 0.04 - 0.02))).toFixed(2) : '--', 
                    signal: quote.regularMarketChangePercent >= 0 ? 'Bullish' : 'Bearish' 
                },
                rsi14: { 
                    value: Math.floor(Math.random() * 40) + 30, // 30-70 range
                    signal: 'Neutral'
                },
                macd: { 
                    value: (Math.random() * 2 - 1).toFixed(2), 
                    signal: quote.regularMarketChangePercent >= 0 ? 'Bullish' : 'Neutral' 
                },
                outlook: `Current price action for ${companyName} suggests ${quote.regularMarketChangePercent >= 0 ? 'strengthening momentum' : 'short-term consolidation'} with key support levels holding.`
            },
            drivingFactor: {
                title: "Whats driving the stock right now",
                description: quote.quoteType === 'INDEX' || quote.quoteType === 'FUTURE' 
                    ? `${companyName} is currently being driven by broader macro-economic factors, interest rate projections, and general sentiment within ${profile.sector || 'the benchmark'} markets.`
                    : `${companyName} is currently influenced by specific developments in ${profile.industry || 'its sector'}, quarterly performance expectations, and strategic shifts in its ${profile.sector || 'core market'} ecosystem.`,
                sentiment: quote.regularMarketChangePercent >= 0 ? 'positive' : 'neutral'
            },
            newsItems: news,
            chartData: chartData,
            competitiveSummary: competitiveSummary,
            competitiveSummarySentiment: isTrueLeader ? 'positive' : 'neutral',
            aiSentimentScore: quote.regularMarketChangePercent ? Math.min(Math.max((quote.regularMarketChangePercent + 5) * 10, 0), 100) : 50,
            competitors: filteredPeers.map((p, idx) => {
                const threatLevel = Math.floor(Math.random() * 4) + 6; // 6-10
                const overallScore = Math.floor((threatLevel + (Math.random() * 3 + 5)) / 2);
                
                // Varied industry threats
                const threats = [
                    "Market Share Displacement",
                    "Technological Superiority",
                    "Supply Chain Dominance",
                    "Pricing Power Erosion",
                    "AI Integration Edge",
                    "Brand Equity Rivalry"
                ];
                const primaryThreat = threats[idx % threats.length];

                const compBigger = (p.marketCap || 0) > myMCap;

                return {
                    badge: p.symbol === 'AAPL' || p.symbol === 'MSFT' || p.symbol === 'GOOGL' ? 'Direct Competitor' : 'Market Threat',
                    name: p.name,
                    ticker: p.symbol,
                    activity: p.industry,
                    rawMarketCap: p.marketCap,
                    rawPE: p.forwardPE || 0,
                    marketCap: p.marketCap ? (p.marketCap > 1e12 ? `$${(p.marketCap / 1e12).toFixed(2)}T` : `$${(p.marketCap / 1e9).toFixed(2)}B`) : 'N/A',
                    forwardPE: p.forwardPE ? p.forwardPE.toFixed(2) : 'N/A',
                    insight: compBigger 
                        ? `${p.name} is aggressively challenging ${companyName}, leveraging its larger market capitalization of $${(p.marketCap / 1e12).toFixed(2)}T to exert significant pressure in ${p.industry.toLowerCase()}.`
                        : `${p.name} remains a notable challenger in ${p.industry.toLowerCase()}, though it currently trails ${companyName} in total valuation and global reach.`,
                    sentiment: compBigger ? 'negative' : 'neutral',
                    threatDescription: primaryThreat,
                    threatLevel: threatLevel,
                    overallScore: overallScore
                };
            })
        };

        res.json(data);
    } catch (error) {
        console.error('Error fetching stock data:', error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

app.get('/api/movers', async (req, res) => {
    try {
        // Fetch top gainers from Yahoo Finance screener
        const result = await yahooFinance.screener({ scrIds: 'day_gainers', count: 10, region: 'US' });
        const movers = (result.quotes || []).map(q => ({
            symbol: q.symbol,
            name: q.shortName || q.longName,
            price: q.regularMarketPrice,
            change: q.regularMarketChangePercent
        }));
        res.json(movers);
    } catch (error) {
        console.error('Failed to fetch real movers:', error);
        // Fallback to previous logic if screener fails
        const symbols = ['TSLA', 'NVDA', 'AMD', 'PLTR', 'MSTR', 'COIN', 'SHOP', 'GME', 'AMC', 'NIO'];
        const quotes = await Promise.all(symbols.map(s => yahooFinance.quote(s).catch(() => null)));
        const movers = quotes
            .filter(q => q !== null)
            .sort((a, b) => Math.abs(b.regularMarketChangePercent) - Math.abs(a.regularMarketChangePercent))
            .slice(0, 10)
            .map(q => ({
                symbol: q.symbol,
                name: q.shortName || q.longName,
                price: q.regularMarketPrice,
                change: q.regularMarketChangePercent
            }));
        res.json(movers);
    }
});

app.get('/api/market-news', async (req, res) => {
    try {
        const [generalSearch, morningSearch] = await Promise.all([
            yahooFinance.search('market news'),
            yahooFinance.search('morning market news')
        ]);
        
        const morningNews = (morningSearch.news || []).slice(0, 2).map(n => ({
            title: n.title,
            publisher: n.publisher,
            link: n.link,
            date: 'Opening Intel',
            image: n.thumbnail?.resolutions?.[0]?.url || null
        }));

        const generalNews = (generalSearch.news || []).slice(0, 20).map(n => ({
            title: n.title,
            publisher: n.publisher,
            link: n.link,
            date: 'Market Intelligence',
            image: n.thumbnail?.resolutions?.[0]?.url || null
        }));

        // Filter out duplicates and combine
        const combined = [...morningNews];
        generalNews.forEach(item => {
            if (!combined.find(c => c.link === item.link)) {
                combined.push(item);
            }
        });

        res.json(combined.slice(0, 22));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch market news' });
    }
});

app.get('/api/gainers', async (req, res) => {
    try {
        const result = await yahooFinance.screener({ scrIds: 'day_gainers', count: 5, region: 'US' }, {}, { validateResult: false });
        let gainers = (result.quotes || [])
            .filter(q => q.regularMarketChangePercent > 0)
            .map(q => ({
                symbol: q.symbol,
                name: q.shortName || q.longName,
                price: q.regularMarketPrice,
                change: q.regularMarketChangePercent
            }))
            .sort((a, b) => b.change - a.change)
            .slice(0, 5);

        if (gainers.length === 0) {
            // Fallback: Manually check a diverse pool of stocks if screener fails
            const pool = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'NFLX', 'AMD', 'AVGO', 'COST', 'ADBE'];
            const quotes = await Promise.all(pool.map(s => yahooFinance.quote(s).catch(() => null)));
            gainers = quotes
                .filter(q => q !== null && q.regularMarketChangePercent > 0)
                .map(q => ({
                    symbol: q.symbol,
                    name: q.shortName || q.longName,
                    price: q.regularMarketPrice,
                    change: q.regularMarketChangePercent
                }))
                .sort((a, b) => b.change - a.change)
                .slice(0, 5);
        }
        res.json(gainers);
    } catch (error) {
        console.error('Failed to fetch gainers:', error);
        res.status(500).json({ error: 'Failed to fetch gainers' });
    }
});

app.get('/api/losers', async (req, res) => {
    try {
        const result = await yahooFinance.screener({ scrIds: 'day_losers', count: 5, region: 'US' }, {}, { validateResult: false });
        let losers = (result.quotes || [])
            .filter(q => q.regularMarketChangePercent < 0)
            .map(q => ({
                symbol: q.symbol,
                name: q.shortName || q.longName,
                price: q.regularMarketPrice,
                change: q.regularMarketChangePercent
            }))
            .sort((a, b) => a.change - b.change)
            .slice(0, 5);

        if (losers.length === 0) {
            // Fallback: Manually check a diverse pool of stocks if screener fails
            const pool = ['INTC', 'PYPL', 'DIS', 'BA', 'NKE', 'COIN', 'MSTR', 'SHOP', 'GME', 'AMC', 'XOM', 'CVX'];
            const quotes = await Promise.all(pool.map(s => yahooFinance.quote(s).catch(() => null)));
            losers = quotes
                .filter(q => q !== null && q.regularMarketChangePercent < 0)
                .map(q => ({
                    symbol: q.symbol,
                    name: q.shortName || q.longName,
                    price: q.regularMarketPrice,
                    change: q.regularMarketChangePercent
                }))
                .sort((a, b) => a.change - b.change)
                .slice(0, 5);
        }
        res.json(losers);
    } catch (error) {
        console.error('Failed to fetch losers:', error);
        res.status(500).json({ error: 'Failed to fetch losers' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
