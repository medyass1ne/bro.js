/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://brojs.yessindevs.me',
  generateRobotsTxt: true,
  exclude: ['*/_meta'],
  robotsTxtOptions: {
    policies: [
      { userAgent: '*', allow: '/' },
      // OpenAI & ChatGPT
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'ChatGPT-User', allow: '/' },
      // Anthropic & Claude
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'Claude-Web', allow: '/' },
      { userAgent: 'anthropic-ai', allow: '/' },
      // Google AI, Gemini & Search
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'Googlebot', allow: '/' },
      { userAgent: 'GoogleOther', allow: '/' },
      // AI Search Engines & Scrapers
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'CCBot', allow: '/' },
      { userAgent: 'Omgilibot', allow: '/' },
      { userAgent: 'Omgili', allow: '/' },
    ]
  }
}