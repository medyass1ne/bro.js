import { useConfig } from 'nextra-theme-docs'
import { useRouter } from 'next/router'

export default {
  logo: <img src="/bro.js-124-nobg.png" alt="bro.js Logo" width="64" height="64" />,
  head: () => {
    const { frontMatter } = useConfig();
    const { asPath } = useRouter();

    const pathWithoutQuery = asPath.split('?')[0].replace(/\/$/, '');
    const segments = pathWithoutQuery.split('/').filter(Boolean);
    
    const itemListElement = [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": "https://brojs.yessindevs.me"
      }
    ];

    let currentUrl = "https://brojs.yessindevs.me";
    segments.forEach((segment, index) => {
      currentUrl += `/${segment}`;
      const name = segment
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      itemListElement.push({
        "@type": "ListItem",
        "position": index + 2,
        "name": name,
        "item": currentUrl
      });
    });

    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": itemListElement
    };

    return (
      <>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta property="og:title" content={frontMatter.title || 'bro.js'} />
        <meta property="og:description" content={frontMatter.description || 'The zero-boilerplate Node.js backend framework.'} />
        <meta name="description" content={frontMatter.description || 'The zero-boilerplate Node.js backend framework.'} />
        <meta property="og:image" content="https://brojs.yessindevs.me/bro.js.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" type="image/png" sizes="48x48" href="https://brojs.yessindevs.me/favicon-48x48.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="https://brojs.yessindevs.me/icon-192.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="https://brojs.yessindevs.me/icon-180.png" />
        <meta property="og:site_name" content="bro.js" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              "name": "bro.js",
              "url": "https://brojs.yessindevs.me"
            })
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(breadcrumbSchema)
          }}
        />
      </>
    );
  },
  project: {
    link: 'https://github.com/medyass1ne/bro.js'
  },
  footer: {
    text: 'Built with bro.js'
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – bro.js'
    }
  },
  darkMode: true,
  search: {
    placeholder: 'Search documentation...'
  },
  toc: {
    float: true
  },
  editLink: {
    component: () => null
  }
}
