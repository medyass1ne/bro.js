export default {
  logo: <img src="/bro.js-124-nobg.png" alt="bro.js Logo" width="64" height="64" />,
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
