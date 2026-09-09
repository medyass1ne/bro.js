export default {
  logo: <span>bro.js</span>,
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
