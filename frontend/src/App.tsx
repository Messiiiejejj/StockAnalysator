import React, { useState } from 'react';
import axios from 'axios';
import { Search, TrendingUp, ShieldAlert, LineChart, Star, Newspaper, Activity, Zap, ArrowUpRight, Info } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import './App.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface Metric {
  value: string;
  comment: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

interface Competitor {
  badge: string;
  name: string;
  ticker: string;
  activity: string;
  marketCap: string;
  forwardPE: string;
  rawMarketCap: number;
  rawPE: number;
  insight: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  threatDescription: string;
  threatLevel: number;
  overallScore: number;
}

interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  date: string;
  image?: string;
}

interface StockData {
  symbol: string;
  companyName: string;
  quoteType: string;
  baseMetrics: {
    marketCap: number;
    peRatio: number;
  };
  price: Metric & { change: string };
  range52Week: Metric;
  marketCap: Metric;
  peRatio: Metric;
  priceToBook: Metric;
  priceToSales: Metric;
  fyEPS: Metric & { year: string };
  analystTarget: Metric;
  technicalSignals: {
    sma20: { value: string; signal: string };
    rsi14: { value: string; signal: string };
    macd: { value: string; signal: string };
    outlook: string;
  };
  drivingFactor: { title: string; description: string; sentiment: 'positive' | 'negative' | 'neutral' };
  newsItems: NewsItem[];
  chartData: { date: string, close: number }[];
  competitiveSummary: string;
  competitiveSummarySentiment: 'positive' | 'negative' | 'neutral';
  aiSentimentScore: number;
  competitors: Competitor[];
}

interface TrendingStock {
  symbol: string;
  name: string;
  price: number;
  change: number;
}

interface IndexData {
  symbol: string;
  name: string;
  price: number;
  change: number;
}

const METRIC_EXPLANATIONS: Record<string, string> = {
  'Share Price': 'The current price of a single share of the company.',
  '52-Week Range': 'The highest and lowest price the stock has reached over the last 52 weeks.',
  'Market Cap': "Total market value of a company's outstanding shares (Price x Total Shares).",
  'P/E Ratio': 'Price-to-Earnings ratio. Measures current share price relative to per-share earnings. High P/E could mean overvalued or high growth.',
  'Price / Book': "Compares a firm's market capitalization to its book value.",
  'Price / Sales': "Compares a company's stock price to its revenues.",
  'EPS Est.': 'Earnings Per Share Estimate. The portion of a company\'s profit allocated to each outstanding share of common stock.',
  'Analyst Avg Target': 'The average price target set by financial analysts for the stock.',
  'Open Interest': 'The total number of outstanding derivative contracts that have not been settled.',
  'Avg Volume': 'The average number of shares traded per day.',
  'Daily Volume': 'The number of shares or contracts traded in a single day.',
  'Day High': 'The highest price at which a stock traded during the course of the trading day.',
  'Day Low': 'The lowest price at which a stock traded during the course of the trading day.',
  'Expiry Date': 'The date on which a derivative contract (like a future) expires.',
  '3M Growth': 'Percentage growth over the last 3 months.',
  'Prev. Close': 'The final price at which a security traded on the previous trading day.',
  'SMA 20': '20-day Simple Moving Average. Average price over the last 20 days. Used to identify short-term trends.',
  'RSI 14': 'Relative Strength Index (14-day). Measures the speed and change of price movements. Above 70 is overbought, below 30 is oversold.',
  'MACD': 'Moving Average Convergence Divergence. A trend-following momentum indicator that shows the relationship between two moving averages of a security’s price.',
};

const API_BASE_URL = 'https://stock-market-backend-6i4h.onrender.com/api';

function App() {
  const [query, setQuery] = useState('');
  const [stock, setStock] = useState<StockData | null>(null);
  const [trending, setTrending] = useState<TrendingStock[]>([]);
  const [gainers, setGainers] = useState<TrendingStock[]>([]);
  const [losers, setLosers] = useState<TrendingStock[]>([]);
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [marketNews, setMarketNews] = useState<NewsItem[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('nextrade_favorites');
    return saved ? JSON.parse(saved) : [];
  });
  const [favData, setFavData] = useState<TrendingStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'technicals' | 'news'>('overview');
  const [chartTimeframe, setChartTimeframe] = useState('1Y');

  React.useEffect(() => {
    fetchTrending();
    fetchGainers();
    fetchLosers();
    fetchMarketNews();
    fetchIndices();
    const tickerInterval = setInterval(fetchIndices, 60000); 
    return () => clearInterval(tickerInterval);
  }, []);

  React.useEffect(() => {
    localStorage.setItem('nextrade_favorites', JSON.stringify(favorites));
    if (favorites.length > 0) {
      fetchFavoritesData();
    } else {
      setFavData([]);
    }
  }, [favorites]);

  const fetchIndices = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/indices`);
      if (response.data && response.data.length > 0) {
        setIndices(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch indices', err);
    }
  };

  const fetchFavoritesData = async () => {
    try {
      const results = await Promise.all(
        favorites.map(s => axios.get(`${API_BASE_URL}/stock/${s}`).catch(() => null))
      );
      const data = results
        .filter(r => r !== null && r.data)
        .map(r => ({
          symbol: r?.data?.symbol || '',
          name: r?.data?.companyName || '',
          price: parseFloat(r?.data?.price?.value?.replace('$', '').replace(',', '') || '0'),
          change: parseFloat(r?.data?.price?.change || '0')
        }));
      setFavData(data);
    } catch (err) {
      console.error('Failed to fetch favorites data', err);
    }
  };

  const toggleFavorite = (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    setFavorites(prev => 
      prev.includes(symbol) 
        ? prev.filter(s => s !== symbol) 
        : [...prev, symbol]
    );
  };

  const fetchTrending = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/trending`);
      setTrending(response.data);
    } catch (err) {
      console.error('Failed to fetch trending', err);
    }
  };

  const fetchGainers = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/gainers`);
      setGainers(response.data);
    } catch (err) {
      console.error('Failed to fetch gainers', err);
    }
  };

  const fetchLosers = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/losers`);
      setLosers(response.data);
    } catch (err) {
      console.error('Failed to fetch losers', err);
    }
  };

  const fetchMarketNews = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/market-news`);
      setMarketNews(response.data);
    } catch (err) {
      console.error('Failed to fetch market news', err);
    }
  };

  const fetchStock = async (symbol: string) => {
    setLoading(true);
    setError('');
    setActiveTab('overview');
    setChartTimeframe('1Y');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const response = await axios.get(`${API_BASE_URL}/stock/${symbol}`);
      setStock(response.data);
    } catch (err) {
      setError('Stock not found. Please try another ticker or company name.');
      setStock(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      fetchStock(query.toUpperCase());
    }
  };

  const MetricCard = ({ title, metric, type }: { title: string, metric: Metric, type?: string }) => {
    let displayTitle = title;
    let explanationKey = title;

    if (type === 'FUTURE' || type === 'INDEX') {
      if (title === 'Market Cap') displayTitle = type === 'FUTURE' ? 'Open Interest' : 'Avg Volume';
      if (title === 'P/E Ratio') displayTitle = 'Daily Volume';
      if (title === 'Price / Book') displayTitle = 'Day High';
      if (title === 'Price / Sales') displayTitle = 'Day Low';
      if (title.includes('EPS Est.')) displayTitle = type === 'FUTURE' ? 'Expiry Date' : '3M Growth';
      if (title === 'Analyst Avg Target') displayTitle = 'Prev. Close';
      explanationKey = displayTitle;
    } else if (title.includes('EPS Est.')) {
      explanationKey = 'EPS Est.';
    }

    const explanation = METRIC_EXPLANATIONS[explanationKey];

    return (
      <div className={`metric-card glass-panel`}>
        <div className="m-label">
          {displayTitle}
          {explanation && (
            <div className="info-tooltip-container">
              <Info size={12} className="info-icon" />
              <div className="tooltip-text">{explanation}</div>
            </div>
          )}
        </div>
        <div className={`m-value ${metric.sentiment}`}>{metric.value}</div>
        <div className={`m-subtext ${metric.sentiment}`}>{metric.comment}</div>
      </div>
    );
  };

  const StockChart = ({ data, timeframe }: { data: { date: string, close: number }[], timeframe: string }) => {
    let displayData = [...data];
    if (timeframe === '1W') displayData = data.slice(-7);
    else if (timeframe === '1M') displayData = data.slice(-30);
    else if (timeframe === '3M') displayData = data.slice(-90);

    const chartData = {
      labels: displayData.map(d => new Date(d.date).toLocaleDateString()),
      datasets: [
        {
          label: 'Close Price',
          data: displayData.map(d => d.close),
          fill: true,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4,
          pointRadius: 0,
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index' as const,
          intersect: false,
          backgroundColor: '#0b0f19',
          titleColor: '#94a3b8',
          bodyColor: '#f8fafc',
          borderColor: '#334155',
          borderWidth: 1,
        },
      },
      scales: {
        x: { display: false },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { size: 10 } },
        },
      },
    };

    return (
      <div className="chart-container glass-panel">
        <div className="chart-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <LineChart size={18} style={{ color: 'var(--accent-blue)' }} />
            <h3>Institutional Performance</h3>
          </div>
          <div className="timeframe-toggles" style={{ display: 'flex', background: 'rgba(15, 23, 42, 0.5)', padding: '0.25rem', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
            {['1W', '1M', '3M', '1Y'].map(tf => (
              <button 
                key={tf}
                onClick={() => setChartTimeframe(tf)}
                className={`tf-btn ${chartTimeframe === tf ? 'active' : ''}`}
                style={{
                  padding: '0.25rem 0.75rem',
                  fontSize: '0.7rem',
                  fontWeight: '700',
                  borderRadius: '0.4rem',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: chartTimeframe === tf ? 'var(--accent-blue)' : 'transparent',
                  color: chartTimeframe === tf ? 'white' : 'var(--text-secondary)',
                  transition: 'all 0.2s'
                }}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height: '300px' }}>
          <Line data={chartData} options={options} />
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
      {/* Ticker Tape */}
      <div className="ticker-tape-container">
        <div className="ticker-tape">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="ticker-tape-content">
              {indices.map((idx, j) => (
                <div key={j} className="ticker-item">
                  {idx.name} <span className={idx.change >= 0 ? 'positive' : 'negative'}>
                    {idx.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({idx.change >= 0 ? '+' : ''}{idx.change.toFixed(2)}%)
                  </span>
                </div>
              ))}
              {indices.length === 0 && (
                <>
                  <div className="ticker-item">S&P 500 <span className="positive">5,283.40 (+0.82%)</span></div>
                  <div className="ticker-item">NASDAQ <span className="positive">16,448.40 (+1.24%)</span></div>
                  <div className="ticker-item">DOW J <span className="negative">39,170.20 (-0.15%)</span></div>
                  <div className="ticker-item">RUSSELL <span className="positive">2,102.50 (+0.45%)</span></div>
                  <div className="ticker-item">BITCOIN <span className="positive">$67,420.00 (+2.10%)</span></div>
                  <div className="ticker-item">GOLD <span className="negative">$2,345.10 (-0.32%)</span></div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <header className="header sticky-header glass-panel">
        <div className="logo" onClick={() => { setStock(null); setError(''); }} style={{ cursor: 'pointer' }}>NexTrade<span>.</span></div>
        <form className="search-container" onSubmit={handleSearch}>
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search company or ticker (e.g. NVDA, Apple)..." 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">Analyze</button>
        </form>
      </header>

      <div className="content-layout">
        <aside className="left-sidebar fade-in">
          <h3 className="section-title">Top Bullish</h3>
          <div className="trending-list" style={{ marginBottom: '2.5rem' }}>
            {gainers.map((s) => (
              <div key={s.symbol} className="trending-item glass-panel" onClick={() => fetchStock(s.symbol)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span className="trending-symbol">{s.symbol}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div className={`trending-price positive`}>${s.price.toFixed(2)}</div>
                    <span className={`trending-change positive`}>
                      +{s.change.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h3 className="section-title">Top Bearish</h3>
          <div className="trending-list">
            {losers.map((s) => (
              <div key={s.symbol} className="trending-item glass-panel" onClick={() => fetchStock(s.symbol)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span className="trending-symbol">{s.symbol}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div className={`trending-price negative`}>${s.price.toFixed(2)}</div>
                    <span className={`trending-change negative`}>
                      {s.change.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="main-content">
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <span>Scanning global markets and AI sentiment...</span>
            </div>
          )}
          
          {error && <div className="error-message">{error}</div>}

          {stock && !loading && (
            <main className="dashboard fade-in">
              <section className="stock-hero-new">
                <div className="hero-top">
                  <div className="ht-left">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <h1>{stock.companyName}</h1>
                      <button 
                        onClick={(e) => toggleFavorite(e, stock.symbol)}
                        className="fav-toggle"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: favorites.includes(stock.symbol) ? 'var(--accent-blue)' : 'var(--text-secondary)' }}
                      >
                        <Star size={24} fill={favorites.includes(stock.symbol) ? "var(--accent-blue)" : "none"} />
                      </button>
                    </div>
                    <span className="ticker-badge">{stock.symbol}</span>
                  </div>
                </div>
              </section>

              <div className="metrics-grid-4">
                <MetricCard title="Share Price" metric={stock.price} type={stock.quoteType} />
                <MetricCard title="52-Week Range" metric={stock.range52Week} type={stock.quoteType} />
                <MetricCard title="Market Cap" metric={stock.marketCap} type={stock.quoteType} />
                <MetricCard title="P/E Ratio" metric={stock.peRatio} type={stock.quoteType} />
                <MetricCard title="Price / Book" metric={stock.priceToBook} type={stock.quoteType} />
                <MetricCard title="Price / Sales" metric={stock.priceToSales} type={stock.quoteType} />
                <MetricCard title={`${stock.fyEPS.year} EPS Est.`} metric={stock.fyEPS} type={stock.quoteType} />
                <MetricCard title="Analyst Avg Target" metric={stock.analystTarget} type={stock.quoteType} />
              </div>

              <div className="tab-navigation-premium">
                <button className={`tab-link ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
                <button className={`tab-link ${activeTab === 'technicals' ? 'active' : ''}`} onClick={() => setActiveTab('technicals')}>Technicals</button>
                <button className={`tab-link ${activeTab === 'news' ? 'active' : ''}`} onClick={() => setActiveTab('news')}>News</button>
              </div>

              {activeTab === 'overview' && (
                <div className="tab-content fade-in space-y-8">
                  <section className="drivers-section-full glass-panel">
                    <div className="drivers-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Zap size={20} className="drivers-icon" />
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '800' }}>AI Market Sentiment</h2>
                      </div>
                      <div className="sentiment-indicator-box">
                        <div className="sentiment-labels">
                          <span>Bearish</span>
                          <span>Bullish</span>
                        </div>
                        <div className="sentiment-bar-track">
                          <div className="sentiment-bar-gradient"></div>
                          <div className="sentiment-marker" style={{ left: `${stock.aiSentimentScore}%` }}></div>
                        </div>
                      </div>
                    </div>
                    <p className={`drivers-text ${stock.drivingFactor.sentiment}`}>{stock.drivingFactor.description}</p>
                  </section>

                  <StockChart data={stock.chartData} timeframe={chartTimeframe} />

                  <div className="section-divider">
                    <ShieldAlert size={20} className="divider-icon" style={{ color: 'var(--negative)' }} />
                    <h2 style={{ fontSize: '1.25rem', fontWeight: '800' }}>Competitive Threat Landscape</h2>
                  </div>

                  <div className="competitors-grid-2x2">
                    {stock.competitors.map((comp, idx) => (
                      <div key={idx} className="comp-card-new glass-panel">
                        <div className="comp-badge-row">
                          <span className={`comp-badge ${comp.overallScore > 7.5 ? 'high' : 'medium'}`}>
                            {comp.badge}
                          </span>
                        </div>
                        <h3 className="comp-name-new">{comp.name}</h3>
                        <div className="comp-subtext-new">{comp.ticker} • {comp.activity}</div>
                        <div className="comp-stats-table">
                          <div className="stat-row">
                            <span>Market Cap</span>
                            <span className={`stat-val ${comp.rawMarketCap > stock.baseMetrics.marketCap ? 'positive' : 'negative'}`}>
                              {comp.marketCap}
                            </span>
                          </div>
                          <div className="stat-row">
                            <span>Forward P/E</span>
                            <span className={`stat-val ${comp.rawPE > stock.baseMetrics.peRatio ? 'positive' : 'negative'}`}>
                              {comp.forwardPE}
                            </span>
                          </div>
                        </div>
                        <p className={`comp-description-new ${comp.sentiment}`} style={{ fontSize: '0.9rem' }}>{comp.insight}</p>
                        
                        <div className="comp-threat-bars">
                          <div className="threat-item">
                            <div className="threat-info-row">
                              <span>Industry Threat</span>
                              <span className="threat-val-new">{comp.threatLevel}/10</span>
                            </div>
                            <div className="threat-bar-new">
                              <div className={`tb-fill ${comp.threatLevel > 8 ? 'high' : 'medium'}`} style={{ width: `${comp.threatLevel * 10}%` }}></div>
                            </div>
                          </div>
                          <div className="overall-threat-row">
                            <span className="ot-label">Overall Rivalry</span>
                            <span className={`ot-val ${comp.overallScore > 7 ? 'negative' : 'neutral'}`}>{comp.overallScore}/10</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <section className="drivers-section-full glass-panel best-in-class-box">
                    <div className="drivers-header">
                      <TrendingUp size={20} className="drivers-icon" style={{ color: 'var(--positive)' }} />
                      <h2 style={{ fontSize: '1.5rem', fontWeight: '800' }}>Institutional Analysis</h2>
                    </div>
                    <p className={`drivers-text ${stock.competitiveSummarySentiment}`}>{stock.competitiveSummary}</p>
                  </section>
                </div>
              )}

              {activeTab === 'technicals' && (
                <div className="tab-content fade-in space-y-6">
                  <div className="technicals-grid">
                    <div className="glass-panel tech-card">
                      <div className="tech-label">
                        SMA 20
                        <div className="info-tooltip-container">
                          <Info size={12} className="info-icon" />
                          <div className="tooltip-text">{METRIC_EXPLANATIONS['SMA 20']}</div>
                        </div>
                      </div>
                      <div className="tech-value">{stock.technicalSignals.sma20.value}</div>
                      <span className={`tech-badge ${stock.technicalSignals.sma20.signal.toLowerCase()}`}>
                        {stock.technicalSignals.sma20.signal}
                      </span>
                    </div>
                    <div className="glass-panel tech-card">
                      <div className="tech-label">
                        RSI 14
                        <div className="info-tooltip-container">
                          <Info size={12} className="info-icon" />
                          <div className="tooltip-text">{METRIC_EXPLANATIONS['RSI 14']}</div>
                        </div>
                      </div>
                      <div className="tech-value">{stock.technicalSignals.rsi14.value}</div>
                      <span className={`tech-badge ${stock.technicalSignals.rsi14.signal.toLowerCase()}`}>
                        {stock.technicalSignals.rsi14.signal}
                      </span>
                    </div>
                    <div className="glass-panel tech-card">
                      <div className="tech-label">
                        MACD
                        <div className="info-tooltip-container">
                          <Info size={12} className="info-icon" />
                          <div className="tooltip-text">{METRIC_EXPLANATIONS['MACD']}</div>
                        </div>
                      </div>
                      <div className="tech-value">{stock.technicalSignals.macd.value}</div>
                      <span className={`tech-badge ${stock.technicalSignals.macd.signal.toLowerCase()}`}>
                        {stock.technicalSignals.macd.signal}
                      </span>
                    </div>
                  </div>
                  <div className="glass-panel p-8">
                    <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                      <Activity size={20} className="text-blue-400" />
                      Institutional Technical Outlook
                    </h3>
                    <p className="drivers-text neutral">{stock.technicalSignals.outlook}</p>
                  </div>
                </div>
              )}

              {activeTab === 'news' && (
                <div className="tab-content fade-in">
                  <h3 className="section-title">Institutional Intelligence Feed</h3>
                  <div className="news-list-new">
                    {stock.newsItems.map((item, idx) => (
                      <a key={idx} href={item.link} target="_blank" rel="noopener noreferrer" className="news-link">
                        <div className="news-card-new glass-panel">
                          <div className="news-image-container">
                            <img 
                              src={item.image || `https://images.unsplash.com/photo-1611974715855-958e6ad39d60?q=80&w=400&auto=format&fit=crop`} 
                              alt={item.title} 
                              className="news-image" 
                            />
                          </div>
                          <div className="news-content">
                            <div className="news-meta-new">
                              <span>{item.publisher}</span>
                              <span>{item.date}</span>
                            </div>
                            <div className="news-title-new">{item.title}</div>
                            <div className="news-read-more">
                              ANALYZE REPORT <ArrowUpRight size={14} />
                            </div>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </main>
          )}

          {!stock && !loading && !error && (
            <div className="welcome-state fade-in">
              <div className="home-dashboard-header">
                <Newspaper size={20} className="header-icon" style={{ color: 'var(--accent-blue)' }} />
                <h2 style={{ fontSize: '1.5rem', fontWeight: '800' }}>Global Market News</h2>
              </div>
              
              <div className="news-list-new home-news-grid">
                {marketNews.map((item, idx) => (
                  <a key={idx} href={item.link} target="_blank" rel="noopener noreferrer" className="news-link">
                    <div className="news-card-new glass-panel">
                      <div className="news-image-container">
                        <img 
                          src={item.image || `https://images.unsplash.com/photo-1611974715855-958e6ad39d60?q=80&w=400&auto=format&fit=crop`} 
                          alt={item.title} 
                          className="news-image" 
                        />
                      </div>
                      <div className="news-content">
                        <div className="news-meta-new">
                          <span>{item.publisher}</span>
                        </div>
                        <div className="news-title-new">{item.title}</div>
                        <div className="news-read-more">
                          READ INTEL <ArrowUpRight size={14} />
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>

              {favData.length > 0 && (
                <div className="favorites-section">
                  <h3 className="section-title">Favorites</h3>
                  <div className="favorites-grid-dense">
                    {favData.map((s) => (
                      <div key={s.symbol} className="trending-item fav-item-compact glass-panel" onClick={() => fetchStock(s.symbol)}>
                        <span className="trending-symbol">{s.symbol}</span>
                        <div style={{ textAlign: 'right' }}>
                          <div className={`trending-price ${s.change >= 0 ? 'positive' : 'negative'}`}>${s.price.toFixed(2)}</div>
                          <span className={`trending-change ${s.change >= 0 ? 'positive' : 'negative'}`}>
                            {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="trending-sidebar">
          <h3 className="section-title">Famous Stocks</h3>
          <div className="trending-list">
            {trending.map((s) => (
              <div key={s.symbol} className="trending-item glass-panel" onClick={() => fetchStock(s.symbol)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span className="trending-symbol">{s.symbol}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div className={`trending-price ${s.change >= 0 ? 'positive' : 'negative'}`}>${s.price.toFixed(2)}</div>
                    <span className={`trending-change ${s.change >= 0 ? 'positive' : 'negative'}`}>
                      {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
