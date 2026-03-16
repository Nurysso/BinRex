/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gtk: {
          accent: {
            bg: 'var(--gtk-accent-bg-color)',
            fg: 'var(--gtk-accent-fg-color)',
          },
          window: {
            bg: 'var(--gtk-window-bg-color)',
            fg: 'var(--gtk-window-fg-color)',
          },
          headerbar: {
            bg: 'var(--gtk-headerbar-bg-color)',
            fg: 'var(--gtk-headerbar-fg-color)',
          },
          card: {
            bg: 'var(--gtk-card-bg-color)',
            fg: 'var(--gtk-card-fg-color)',
          },
          popover: {
            bg: 'var(--gtk-popover-bg-color)',
            fg: 'var(--gtk-popover-fg-color)',
          },
          view: {
            bg: 'var(--gtk-view-bg-color)',
            fg: 'var(--gtk-view-fg-color)',
          }
        }
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}

