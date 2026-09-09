import { useConfig } from 'nextra-theme-docs'

export default {
  logo: <img src="/bro.js-124-nobg.png" alt="bro.js Logo" width="64" height="64" />,
  head: () => {
    const { frontMatter } = useConfig();
    return (
      <>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta property="og:title" content={frontMatter.title || 'bro.js'} />
        <meta property="og:description" content={frontMatter.description || 'The zero-boilerplate Node.js backend framework.'} />
        <meta name="description" content={frontMatter.description || 'The zero-boilerplate Node.js backend framework.'} />
        <meta property="og:image" content="https://brojs.yessindevs.me/og-image.png" />
        <link rel="icon" type="image/png" href="/bro.js-124.png" />
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
