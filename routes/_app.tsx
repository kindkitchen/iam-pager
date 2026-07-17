import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism.min.css"
          integrity="sha384-rCCjoCPCsizaAAYVoz1Q0CmCTvnctK0JkfCSjx7IIxexTBg+uCKtFYycedUjMyA2"
          crossorigin="anonymous"
        />
        <link rel="stylesheet" href="/site.css" />
        <script
          defer
          src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"
          integrity="sha384-ZM8fDxYm+GXOWeJcxDetoRImNnEAS7XwVFH5kv0pT6RXNy92Nemw/Sj7NfciXpqg"
          crossorigin="anonymous"
        />
        <title>iam-pager</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
