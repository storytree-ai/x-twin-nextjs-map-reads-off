// next/app: the default App renders the page with its props.
import { createElement, Component } from "react";

export default class App extends Component {
  static async getInitialProps({ Component: Page, ctx }) {
    const pageProps = Page && Page.getInitialProps ? await Page.getInitialProps(ctx) : {};
    return { pageProps };
  }
  render() {
    const { Component: Page, pageProps } = this.props;
    return createElement(Page, pageProps);
  }
}
