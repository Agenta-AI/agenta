# Agenta Documentation

This documentation is powered by [Docusaurus](https://docusaurus.io/), a modern and efficient static site generator.

## Getting Started

To set up the documentation locally, follow these steps:

1. **Install Dependencies**  
   First, install the required packages:

   ```bash
   npm install
   ```

2. **Start the Local Development Server**  
   Spin up the server to start working locally:

   ```bash
   npm run start
   ```

   Open your browser and go to `localhost:5000` to view the development site.

3. **Build the Project**  
   Ensure everything is working by building the project:

   ```bash
   npm run build
   ```

4. **Preview the Production Environment**  
   Run the production build server to see how your site will look in production:
   ```bash
   npm run serve
   ```
   Visit `localhost:3000` to explore the production build.

## Changelog Guidelines

When working on the changelog page, following specific formatting rules are important to ensure the page's layout remains intact. Failure to follow these guidelines may result in broken UI elements.

### Key Guidelines for Editing the Changelog Page

1. **Avoid using italic (`**`) formatting** except when specifying the **publishing date\*\*.
2. **Use Heading 3 (`###`)** for all changelog section titles.
3. **Always insert a horizontal rule (`----`)** before beginning a new section of the changelog.
4. **Ensure all content is written within** the `<section class="changelog">...</section>` **elements**. Writing outside of this structure will break the UI.

By inserting to these formatting conventions, you'll maintain the integrity and readability of the changelog page.

## Notes

- Do not update any libraries or packages as this could disrupt the template structure and cause it to break.
- Please use kebab-case (this-way) instead of snake_case for naming files and folders
