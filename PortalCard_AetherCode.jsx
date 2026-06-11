<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portal · AetherCloud</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>/* cyrillic-ext */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("f5d6fcc9-b989-49ae-b9ee-b8436e1ba2b4") format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("b944fe55-efb3-42d7-96a3-01a6c265905d") format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* vietnamese */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("1841019a-67ea-4dc4-bc86-9bcbf39574ab") format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("1f6a61ef-a442-4bb2-a8af-69ef165d7e13") format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("6b08e8a8-3991-4ff6-9472-1ac1dd1d7f6d") format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* cyrillic-ext */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("ad1bea49-8fcc-418c-a3f8-24da752a8f5e") format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("2922c824-8b7e-4632-a368-a9b1af8c9fbc") format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* vietnamese */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("106ffc66-f22b-4513-8b8d-0b7c29d001da") format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("4d1dcf89-7321-491d-8951-3a15379d2e38") format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("f7f86085-1a89-4fa5-9a07-4b8012a6daa5") format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* cyrillic-ext */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("8c8bb37e-7639-441d-a038-ab14bb115583") format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("39101ae5-7543-4d62-ae84-6796b6ed49e0") format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* vietnamese */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("75cbe4c0-c961-473d-839e-e1fc4b39148a") format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("0baee15f-295a-45f2-a030-8c63f39819b3") format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("f7d06ee0-a9df-4537-a9f5-4a53bd241565") format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* cyrillic-ext */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("4b152492-e509-4eaa-a4e7-0e2bd1e68a41") format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("b23216a6-bc6a-47d5-b685-ee43fb205d36") format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* vietnamese */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("09d5e757-daaf-4ae5-bbf8-a8cc313fc553") format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("2837195a-afa4-431b-837e-d4aa7d3b7136") format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("5bbad5f6-3776-427c-89d1-aa207a35e170") format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* cyrillic-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  font-stretch: 100%;
  font-display: swap;
  src: url("2371751c-f578-4f42-9224-9357f9760fce") format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  font-stretch: 100%;
  font-display: swap;
  src: url("316dd600-983f-42ee-a50c-1fb1ea94793b") format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* greek */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  font-stretch: 100%;
  font-display: swap;
  src: url("bb8b3c5e-b4d1-45e2-8e19-9a61ce3aba4d") format('woff2');
  unicode-range: U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF;
}
/* vietnamese */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  font-stretch: 100%;
  font-display: swap;
  src: url("3d63fa8b-c288-4197-94bc-629f26d7b8f3") format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  font-stretch: 100%;
  font-display: swap;
  src: url("cd55d491-2b0e-495b-ba54-b7716bcea7d0") format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  font-stretch: 100%;
  font-display: swap;
  src: url("c8e57e88-0c0b-4be9-8ed7-b2094ad25816") format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* cyrillic-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 500;
  font-stretch: 100%;
  font-display: swap;
  src: url("2371751c-f578-4f42-9224-9357f9760fce") format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 500;
  font-stretch: 100%;
  font-display: swap;
  src: url("316dd600-983f-42ee-a50c-1fb1ea94793b") format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* greek */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 500;
  font-stretch: 100%;
  font-display: swap;
  src: url("bb8b3c5e-b4d1-45e2-8e19-9a61ce3aba4d") format('woff2');
  unicode-range: U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF;
}
/* vietnamese */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 500;
  font-stretch: 100%;
  font-display: swap;
  src: url("3d63fa8b-c288-4197-94bc-629f26d7b8f3") format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 500;
  font-stretch: 100%;
  font-display: swap;
  src: url("cd55d491-2b0e-495b-ba54-b7716bcea7d0") format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 500;
  font-stretch: 100%;
  font-display: swap;
  src: url("c8e57e88-0c0b-4be9-8ed7-b2094ad25816") format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* cyrillic-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 600;
  font-stretch: 100%;
  font-display: swap;
  src: url("2371751c-f578-4f42-9224-9357f9760fce") format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 600;
  font-stretch: 100%;
  font-display: swap;
  src: url("316dd600-983f-42ee-a50c-1fb1ea94793b") format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* greek */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 600;
  font-stretch: 100%;
  font-display: swap;
  src: url("bb8b3c5e-b4d1-45e2-8e19-9a61ce3aba4d") format('woff2');
  unicode-range: U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF;
}
/* vietnamese */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 600;
  font-stretch: 100%;
  font-display: swap;
  src: url("3d63fa8b-c288-4197-94bc-629f26d7b8f3") format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 600;
  font-stretch: 100%;
  font-display: swap;
  src: url("cd55d491-2b0e-495b-ba54-b7716bcea7d0") format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 600;
  font-stretch: 100%;
  font-display: swap;
  src: url("c8e57e88-0c0b-4be9-8ed7-b2094ad25816") format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* cyrillic-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 700;
  font-stretch: 100%;
  font-display: swap;
  src: url("2371751c-f578-4f42-9224-9357f9760fce") format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 700;
  font-stretch: 100%;
  font-display: swap;
  src: url("316dd600-983f-42ee-a50c-1fb1ea94793b") format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* greek */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 700;
  font-stretch: 100%;
  font-display: swap;
  src: url("bb8b3c5e-b4d1-45e2-8e19-9a61ce3aba4d") format('woff2');
  unicode-range: U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF;
}
/* vietnamese */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 700;
  font-stretch: 100%;
  font-display: swap;
  src: url("3d63fa8b-c288-4197-94bc-629f26d7b8f3") format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 700;
  font-stretch: 100%;
  font-display: swap;
  src: url("cd55d491-2b0e-495b-ba54-b7716bcea7d0") format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 700;
  font-stretch: 100%;
  font-display: swap;
  src: url("c8e57e88-0c0b-4be9-8ed7-b2094ad25816") format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
</style>
<style>
  :root{
    --bg:#040507;--surface:#0a0c10;--border:#1a1f2e;--border-2:#252b3d;
    --text:#e8e6e0;--dim:#9ca3af;--muted:#6b7280;
    --cyan:#00d4ff;--cyan-soft:#06b6d4;--gold:#d4a017;--violet:#9a6cff;--green:#00ff88;
    --glass-brd:rgba(150,180,230,.14);
    --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
    --sans:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    --disp:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',system-ui,sans-serif;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;min-height:100%;}
  body{
    min-height:100vh;color:#11151c;font-family:var(--disp);
    font-feature-settings:"ss01","cv11";letter-spacing:-.005em;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
    background:
      radial-gradient(1000px 640px at 14% -6%, rgba(0,120,200,.12), transparent 58%),
      radial-gradient(900px 620px at 92% 8%, rgba(90,70,210,.09), transparent 56%),
      radial-gradient(900px 700px at 50% 116%, rgba(0,150,200,.06), transparent 60%),
      #04070e;
    background-attachment:fixed;
    display:flex;align-items:center;justify-content:center;padding:32px 28px;
  }
  body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
    background-image:
      radial-gradient(2px 2px at 40px 60px, rgba(210,240,255,.95), transparent),
      radial-gradient(1.8px 1.8px at 150px 120px, rgba(255,255,255,.9), transparent),
      radial-gradient(2px 2px at 230px 70px, rgba(170,215,255,.9), transparent),
      radial-gradient(1.6px 1.6px at 90px 200px, rgba(255,255,255,.85), transparent),
      radial-gradient(2.1px 2.1px at 280px 220px, rgba(185,225,255,.9), transparent),
      radial-gradient(1.7px 1.7px at 330px 150px, rgba(255,255,255,.8), transparent);
    background-size:360px 280px;background-repeat:repeat;opacity:.9;
    animation:bgtwk 7s ease-in-out infinite;}
  @keyframes bgtwk{0%,100%{opacity:.7;}50%{opacity:1;}}
  a{text-decoration:none;color:inherit;}

  .wrap{position:relative;z-index:1;width:100%;max-width:1080px;}
  .topauth{display:flex;align-items:center;justify-content:flex-end;gap:16px;margin-bottom:16px;}
  .topauth .brandlogo{height:64px;width:auto;opacity:.6;\n    -webkit-mask-image:radial-gradient(closest-side at 50% 50%, #000 58%, rgba(0,0,0,.35) 82%, transparent 100%);\n    mask-image:radial-gradient(closest-side at 50% 50%, #000 58%, rgba(0,0,0,.35) 82%, transparent 100%);}
  .topauth .authbtns{display:flex;align-items:center;gap:10px;}
  .topauth .login{font-family:var(--disp);font-weight:600;font-size:13px;letter-spacing:-.01em;color:#aab6c8;text-decoration:none;padding:9px 15px;border-radius:3px;border:1px solid transparent;transition:color .15s,background .15s;}
  .topauth .login:hover{color:#fff;background:rgba(255,255,255,.08);}
  .topauth .signup{font-family:var(--disp);font-size:13px;font-weight:700;letter-spacing:-.01em;color:#04202a;text-decoration:none;padding:9px 18px;border-radius:3px;background:linear-gradient(180deg,#3ee0ff,#00bce6);box-shadow:0 6px 16px -8px rgba(0,188,230,.7),inset 0 1px 0 rgba(255,255,255,.5);transition:filter .15s,transform .1s;}
  .topauth .signup:hover{filter:brightness(1.06);}
  .topauth .signup:active{transform:translateY(1px);}
  .masthead{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px;padding:0 4px;}
  .brand{display:flex;align-items:center;gap:12px;}
  .brand .mk{width:30px;height:30px;border-radius:3px;display:grid;place-items:center;background:linear-gradient(150deg,var(--cyan),var(--violet));color:#04202a;font-family:var(--mono);font-weight:700;font-size:15px;box-shadow:0 0 0 1px rgba(150,180,230,.25),0 8px 22px -10px rgba(0,212,255,.8);}
  .brand b{font-family:var(--mono);font-size:14px;font-weight:600;letter-spacing:.16em;}
  .brand small{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.06em;margin-left:2px;}
  .status{font-family:var(--mono);font-size:11px;color:var(--dim);display:flex;align-items:center;gap:8px;border:1px solid var(--glass-brd);border-radius:2px;padding:6px 13px;background:rgba(255,255,255,.03);backdrop-filter:blur(10px);}
  .status .d{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 9px var(--green);}

  .lead{margin:0 4px 18px;}
  .lead h1{font-family:var(--mono);font-weight:600;font-size:24px;letter-spacing:-.01em;margin:0 0 5px;}
  .lead p{color:var(--muted);font-size:13.5px;margin:0;}

  /* ===== bento grid ===== */
  .bento{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(0,1fr);height:min(620px,calc(100vh - 64px));gap:2px;background:rgba(70,150,195,.5);padding:0;border:2px solid rgba(70,150,195,.5);box-shadow:0 0 34px -16px rgba(40,140,200,.45);}
  .tile{
    position:relative;overflow:hidden;display:flex;flex-direction:column;
    border:none;border-radius:0;padding:22px 22px 20px;
    background:#04070e;
    cursor:pointer;transition:transform .3s cubic-bezier(.16,1,.3,1),filter .26s,box-shadow .3s;
  }
  .tile::before{content:none;}
  .tile:hover{transform:scale(1.035);z-index:6;filter:brightness(1.08);box-shadow:0 0 0 2px var(--cyan),0 24px 60px -22px rgba(0,0,0,.92),0 0 56px -12px rgba(0,212,255,.6);}
  .tile .ico{width:42px;height:42px;border-radius:3px;display:grid;place-items:center;border:1px solid var(--glass-brd);background:rgba(255,255,255,.04);margin-bottom:auto;position:relative;z-index:1;}
  .tile .ico svg{width:21px;height:21px;}
  .tile .label{font-family:var(--disp);font-weight:700;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7f92ad;margin-top:auto;margin-bottom:7px;position:relative;z-index:1;}
  .t-models .label{margin-top:0;}
  .tile h2{font-family:var(--mono);font-weight:600;font-size:18px;letter-spacing:-.01em;margin:0 0 5px;position:relative;z-index:1;color:#11151c;}
  .tile p{font-family:var(--disp);font-size:13px;font-weight:400;line-height:1.5;color:#5a616e;margin:0;position:relative;z-index:1;max-width:40ch;}
  .tile .go{display:none;}
  .tile:hover .go{display:none;}
  .tile .ext{font-family:var(--mono);font-size:9px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;margin-top:11px;display:flex;align-items:center;gap:6px;position:relative;z-index:1;}

  /* placement (matches wireframe) */
  .t-back{grid-column:1;grid-row:1;}
  .t-web{grid-column:2;grid-row:1;--ac:rgba(0,212,255,.16);--ah:rgba(0,212,255,.55);}
  .t-platform{grid-column:3;grid-row:1;--ac:rgba(54,211,230,.15);--ah:rgba(54,211,230,.5);}
  .t-models{grid-column:1 / span 2;grid-row:2;--ac:rgba(154,108,255,.16);--ah:rgba(154,108,255,.55);}
  .t-about{grid-column:3;grid-row:2;--ac:rgba(212,160,23,.14);--ah:rgba(212,160,23,.5);}

  /* back tile */
  .t-back{cursor:pointer;justify-content:flex-start;overflow:hidden;
    background:radial-gradient(120% 95% at 28% 30%, #0c1a2e 0%, #070d18 55%, #04070e 100%);border-color:#15263c;}
  .t-back .stars{position:absolute;inset:0;z-index:0;pointer-events:none;}
  .t-back .stars i{position:absolute;border-radius:50%;background:#bfe6ff;animation:twk var(--d,4s) ease-in-out infinite;animation-delay:var(--dl,0s);}
  .t-back .bk{position:relative;z-index:2;}
  .t-back .bk .label{color:#8fd2ff;margin:0 0 5px;}
  .t-back .bk h2{font-family:var(--disp);font-weight:800;font-size:23px;letter-spacing:-.022em;color:#eaf6ff;margin:0 0 6px;display:flex;align-items:center;gap:13px;text-shadow:0 0 18px rgba(0,185,255,.4);}
  .t-back .bk .ar{font-size:34px;font-weight:700;line-height:.8;color:var(--cyan);text-shadow:0 0 16px rgba(0,212,255,.8);transition:transform .24s;}
  .t-back:hover{border-color:rgba(0,212,255,.6);box-shadow:0 1px 2px rgba(0,0,0,.3),0 26px 50px -28px rgba(0,0,0,.6),0 0 40px -16px rgba(0,212,255,.55);}
  .t-back:hover .bk .ar{transform:translateX(-7px);}
  .t-back .bk p{font-family:var(--disp);font-size:13px;color:#b9c6da;margin:0;line-height:1.5;}
  .t-back .go{display:none;}

  .ico.cy{color:var(--cyan);}.ico.cy2{color:var(--cyan-soft);}.ico.vi{color:var(--violet);}.ico.go2{color:var(--gold);}.ico.gr{color:var(--green);}

  /* models tile — overlapping staggered cards, blue blend */
  .t-models{overflow:hidden;padding:0;background:linear-gradient(180deg,#1b2738,#0e1622);border-color:#203049;}
  .t-models .mhead{position:absolute;bottom:0;left:0;right:0;z-index:6;padding:40px 22px 18px;display:flex;align-items:flex-end;justify-content:space-between;gap:14px;
    background:linear-gradient(0deg,#060f1b 0%, rgba(6,15,27,.86) 46%, transparent 100%);}
  .t-models .mhead h2{color:#fff;font-family:var(--disp);font-weight:800;font-size:25px;letter-spacing:-.022em;margin:0;text-shadow:0 2px 16px rgba(0,0,0,.9);}
  .t-models .mhead .more{flex:none;font-family:var(--disp);font-weight:600;font-size:13px;letter-spacing:-.01em;color:var(--cyan);display:flex;align-items:center;gap:5px;white-space:nowrap;padding-bottom:4px;transition:transform .2s;}
  .t-models:hover .mhead .more{transform:translateX(3px);}
  .t-models .go{z-index:7;color:#fff;border-color:rgba(140,210,255,.4);background:rgba(0,180,255,.16);}
  .t-models:hover .go{transform:translate(2px,-2px);color:#fff;border-color:rgba(140,210,255,.7);background:rgba(0,180,255,.5);}
  .cards-fan{position:absolute;inset:0;z-index:1;}
  .cards-fan::after{content:"";position:absolute;inset:0;z-index:5;pointer-events:none;
    background:linear-gradient(180deg, rgba(20,32,52,.30) 0%, rgba(18,30,50,.42) 45%, rgba(13,22,38,.72) 100%),
      radial-gradient(120% 80% at 50% 38%, rgba(90,150,210,.06), transparent 70%);}
  .cards-fan .mc{position:absolute;bottom:-40%;aspect-ratio:372/619;border-radius:8px;overflow:hidden;opacity:.92;
    box-shadow:0 16px 32px -14px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.32);filter:saturate(.72) brightness(.88);
    transition:transform .34s cubic-bezier(.16,1,.3,1),box-shadow .3s,filter .3s,opacity .3s;}
  .cards-fan .mc img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center;}
  .cards-fan .mc.k{left:32%;width:37%;bottom:-16%;transform:rotate(0deg);z-index:2;}
  .cards-fan .mc.p{left:-4%;width:37%;bottom:-18%;transform:rotate(-1.5deg);z-index:4;}
  .cards-fan .mc.n{right:-4%;width:37%;bottom:-18%;transform:rotate(1.5deg);z-index:3;}
  .t-models:hover .mc.p{transform:rotate(-3.5deg) translateY(-8px);}
  .t-models:hover .mc.k{transform:rotate(0deg) translateY(-11px);}
  .t-models:hover .mc.n{transform:rotate(3.5deg) translateY(-8px);}
  .t-models:hover .mc{filter:saturate(.85) brightness(.96);opacity:1;}

  /* aether code tile — AETHER wordmark + cloud, blue blend */
  .t-code{background:radial-gradient(120% 95% at 50% 34%, #0c1a2e 0%, #070d18 55%, #04070e 100%) !important;border-color:#15263c !important;}
  .t-code .mhead{background:linear-gradient(0deg,#04070e 0%, rgba(4,7,14,.86) 46%, transparent 100%) !important;}
  .t-code .code-art{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;padding:18px 26px 52px;transition:transform .28s ease;}
  .t-code .code-art::before{content:"";position:absolute;width:78%;height:70%;border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,.26),transparent 70%);filter:blur(20px);transition:opacity .28s ease;opacity:.8;}
  .t-code .code-cloud{position:relative;width:78px;height:auto;filter:drop-shadow(0 0 13px rgba(56,189,248,.6)) drop-shadow(0 0 3px rgba(190,238,255,.7));animation:codebob 5.2s ease-in-out infinite;}
  @keyframes codebob{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}
  .t-code .code-aether{position:relative;margin:0;width:100%;font-family:var(--mono);font-weight:700;line-height:1;font-size:clamp(11px,2.2vw,18px);white-space:pre;user-select:none;text-align:center;
    background:linear-gradient(96deg,#7defff 0%,#2af2e6 30%,#22d3ee 55%,#38bdf8 78%,#5aa6ff 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    filter:drop-shadow(0 0 1px rgba(190,250,255,.85)) drop-shadow(0 0 8px rgba(45,214,238,.5)) drop-shadow(0 0 22px rgba(56,189,248,.32));}
  .t-code:hover .code-art{transform:translateY(-3px);}
  .t-code:hover .code-art::before{opacity:1;}
  @media (max-width:560px){ .t-code .code-aether{font-size:11px;} }

  /* web tile — floating cloud in a starfield */
  .t-web{overflow:hidden;align-items:center;justify-content:center;text-align:center;
    background:radial-gradient(120% 95% at 50% 30%, #0c1a2e 0%, #070d18 55%, #04070e 100%);border-color:#15263c;}
  .t-web .go{z-index:5;color:#cfe9ff;border-color:rgba(120,200,255,.32);background:rgba(120,200,255,.1);}
  .t-web:hover{border-color:rgba(0,212,255,.6);box-shadow:0 1px 2px rgba(0,0,0,.3),0 26px 50px -28px rgba(0,0,0,.6),0 0 40px -16px rgba(0,212,255,.6);}
  .t-web .stars{position:absolute;inset:0;z-index:0;pointer-events:none;}
  .t-web .stars i{position:absolute;border-radius:50%;background:#bfe6ff;animation:twk var(--d,4s) ease-in-out infinite;animation-delay:var(--dl,0s);}
  @keyframes twk{0%,100%{opacity:.15;transform:translateY(0);}50%{opacity:.85;transform:translateY(-5px);}}
  .t-web .webinner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:20px;}
  .t-web .cloudwrap{position:relative;display:grid;place-items:center;animation:cloudbob 4.5s ease-in-out infinite;}
  .t-web .cloudwrap::before{content:"";position:absolute;width:138px;height:138px;border-radius:50%;
    background:radial-gradient(circle,rgba(0,185,255,.55),rgba(0,185,255,0) 68%);}
  .t-web .cloud{position:relative;width:90px;height:auto;image-rendering:pixelated;filter:drop-shadow(0 8px 18px rgba(0,180,255,.6));}
  @keyframes cloudbob{0%,100%{transform:translateY(0);}50%{transform:translateY(-7px);}}
  .t-web .weblabel{font-family:var(--disp);font-weight:800;font-size:23px;letter-spacing:-.022em;line-height:1.24;white-space:nowrap;color:#eaf6ff;text-shadow:0 0 18px rgba(0,185,255,.5);}
  .t-web .weblabel b{color:var(--cyan);font-weight:700;}

  /* platform tile — laptop image blended into card */
  .t-platform{overflow:hidden;justify-content:flex-end;background:#04070e;}
  .t-platform .lap{position:absolute;inset:0;z-index:0;background:url("assets/platform-laptop.jpg") center 36%/cover no-repeat;
    transform:scale(1.04);transition:transform .5s cubic-bezier(.16,1,.3,1);}
  .t-platform::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;
    background:
      linear-gradient(180deg, rgba(4,7,14,0) 0%, rgba(4,7,14,.2) 42%, rgba(4,7,14,.84) 78%, rgba(4,7,14,.97) 100%),
      radial-gradient(130% 80% at 50% 8%, rgba(0,150,220,.12), transparent 62%);}
  .t-platform:hover .lap{transform:scale(1.07);}
  .t-platform .go{z-index:5;color:#cfe9ff;border-color:rgba(120,200,255,.32);background:rgba(120,200,255,.12);}
  .t-platform .platxt{position:relative;z-index:3;}
  .t-platform .platxt .label{color:#8fd2ff;margin:0 0 5px;}
  .t-platform .platxt h2{font-family:var(--disp);font-weight:800;font-size:23px;letter-spacing:-.022em;color:#fff;margin:0 0 6px;text-shadow:0 2px 14px rgba(0,0,0,.8);}
  .t-platform .platxt p{font-family:var(--disp);font-size:13px;line-height:1.5;color:#b9c6da;margin:0;max-width:34ch;}

  /* about tile — subtle spinning globe in space */
  .t-about{overflow:hidden;justify-content:flex-end;
    background:radial-gradient(120% 95% at 50% 28%, #0c1a2e 0%, #070d18 55%, #04070e 100%);}
  .t-about .stars{position:absolute;inset:0;z-index:0;pointer-events:none;}
  .t-about .stars i{position:absolute;border-radius:50%;background:#bfe6ff;animation:twk var(--d,4s) ease-in-out infinite;animation-delay:var(--dl,0s);}
  .t-about .globe{position:absolute;top:9%;left:50%;transform:translateX(-50%);width:56%;aspect-ratio:1/1;border-radius:50%;overflow:hidden;z-index:1;
    box-shadow:0 0 40px -4px rgba(0,140,235,.5),inset 0 0 38px -10px rgba(0,0,0,.85);}
  .t-about .globe .strip{position:absolute;top:0;left:0;height:100%;width:200%;
    background:url("assets/about-globe.webp") repeat-x;background-size:50% 100%;
    animation:roll 34s linear infinite;}
  @keyframes roll{from{transform:translateX(0);}to{transform:translateX(-50%);}}
  .t-about .globe .shade{position:absolute;inset:0;border-radius:50%;pointer-events:none;
    background:
      radial-gradient(circle at 36% 30%, rgba(120,200,255,.22), rgba(255,255,255,0) 44%),
      radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 50%, rgba(2,10,22,.45) 74%, rgba(2,8,18,.92) 100%);}
  .t-about::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;
    background:linear-gradient(180deg, rgba(4,7,14,0) 48%, rgba(4,7,14,.45) 72%, rgba(4,7,14,.92) 100%);}
  .t-about .go{z-index:5;color:#cfe9ff;border-color:rgba(120,200,255,.32);background:rgba(120,200,255,.12);}
  .t-about .aboutxt{position:relative;z-index:3;}
  .t-about .aboutxt .label{color:#8fd2ff;margin:0 0 5px;}
  .t-about .aboutxt h2{font-family:var(--disp);font-weight:800;font-size:23px;letter-spacing:-.022em;color:#fff;margin:0 0 6px;text-shadow:0 2px 14px rgba(0,0,0,.85);}
  .t-about .aboutxt p{font-family:var(--disp);font-size:13px;line-height:1.5;color:#b9c6da;margin:0;max-width:34ch;}

  /* account strip */
  .acct{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  @media(max-width:720px){.acct{grid-template-columns:1fr;}}
  .acard{
    position:relative;overflow:hidden;display:flex;align-items:center;gap:16px;
    border:1px solid var(--glass-brd);border-radius:3px;padding:18px 20px;cursor:pointer;
    background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.01));
    backdrop-filter:blur(18px) saturate(1.3);-webkit-backdrop-filter:blur(18px) saturate(1.3);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
    transition:transform .22s,border-color .2s,box-shadow .22s;
  }
  .acard:hover{transform:translateY(-3px);border-color:rgba(0,212,255,.45);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 20px 44px -26px rgba(0,0,0,.85),0 0 34px -18px rgba(0,212,255,.5);}
  .acard .ico{width:40px;height:40px;border-radius:3px;display:grid;place-items:center;border:1px solid var(--glass-brd);background:rgba(255,255,255,.04);flex:none;}
  .acard .ico svg{width:20px;height:20px;}
  .acard .at{display:flex;flex-direction:column;gap:3px;min-width:0;}
  .acard .at b{font-family:var(--mono);font-size:14px;font-weight:600;}
  .acard .at small{font-size:12px;color:var(--muted);}
  .acard .go{margin-left:auto;width:30px;height:30px;border-radius:2px;border:1px solid var(--glass-brd);display:grid;place-items:center;color:var(--dim);font-size:14px;background:rgba(255,255,255,.03);flex:none;transition:transform .22s,color .2s,border-color .2s,background .2s;}
  .acard:hover .go{transform:translate(2px,-2px);color:#fff;border-color:rgba(0,212,255,.5);background:rgba(0,212,255,.16);}

  .footer{margin-top:22px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:0 4px;font-family:var(--mono);font-size:11px;color:#9aa1ad;}
  .footer a{color:#5a616e;}
  .footer a:hover{color:var(--cyan-soft);text-decoration:underline;text-underline-offset:2px;}

  @media(max-width:860px){
    .bento{grid-template-columns:repeat(2,1fr);grid-auto-rows:218px;}
    .t-back{grid-column:1;grid-row:1;}
    .t-web{grid-column:2;grid-row:1;}
    .t-platform{grid-column:1;grid-row:2;}
    .t-models{grid-column:2;grid-row:2;}
    .t-about{grid-column:1 / span 2;grid-row:3;}
  }
  @media(max-width:560px){
    .bento{grid-template-columns:1fr;grid-auto-rows:auto;}
    .bento .tile{grid-column:1 !important;grid-row:auto !important;min-height:150px;}
  }
</style>
</head>
<body>
  <template id="__bundler_thumbnail" data-bg-color="#04070e">
    <svg viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="800" fill="#04070e"/>
      <g fill="none" stroke="#1e7fd6" stroke-width="6">
        <rect x="120" y="150" width="300" height="240"/>
        <rect x="440" y="150" width="300" height="240"/>
        <rect x="760" y="150" width="320" height="240"/>
        <rect x="120" y="410" width="620" height="240"/>
        <rect x="760" y="410" width="320" height="240"/>
      </g>
      <text x="430" y="560" font-family="monospace" font-size="86" font-weight="700" fill="#38d6ee">AETHER</text>
    </svg>
  </template>
  <div class="wrap">
    <div class="topauth">
      <div class="authbtns">
        <a class="login" href="https://aethersystems.net/login">Log in</a>
        <a class="signup" href="https://aethersystems.net/signup">Sign up</a>
      </div>
      <img class="brandlogo" src="assets/aether-logo.png" alt="Aether AI">
    </div>
    <div class="bento">
      <!-- back -->
      <a class="tile t-back" href="https://aethersystems.net">
        <div class="stars">
          <i style="left:16%;top:22%;width:3px;height:3px;--d:4.6s;--dl:.3s;"></i>
          <i style="left:30%;top:64%;width:2px;height:2px;background:#fff;--d:5.6s;--dl:1.2s;"></i>
          <i style="left:22%;top:82%;width:3px;height:3px;--d:6.1s;--dl:.6s;"></i>
          <i style="left:54%;top:20%;width:2px;height:2px;background:#fff;--d:4.9s;--dl:.8s;"></i>
          <i style="left:68%;top:70%;width:3px;height:3px;--d:5.3s;--dl:.2s;"></i>
          <i style="left:80%;top:30%;width:2px;height:2px;--d:6.3s;--dl:1.5s;"></i>
          <i style="left:86%;top:58%;width:3px;height:3px;background:#fff;--d:4.7s;--dl:.7s;"></i>
          <i style="left:44%;top:48%;width:2px;height:2px;--d:5.9s;--dl:1.0s;"></i>
          <i style="left:62%;top:40%;width:2px;height:2px;background:#fff;--d:5.1s;--dl:.45s;"></i>
        </div>
        <div class="bk">
          <div class="label">Exit</div>
          <h2><span class="ar">←</span> Back</h2>
          <p>Return to aethersystems.net</p>
        </div>
      </a>

      <!-- aether ai on the web -->
      <a class="tile t-web" href="Aether Web Chat.html">
        <div class="stars">
          <i style="left:12%;top:18%;width:3px;height:3px;--d:4.5s;--dl:.2s;"></i>
          <i style="left:24%;top:58%;width:2px;height:2px;background:#fff;--d:5.5s;--dl:1.1s;"></i>
          <i style="left:18%;top:80%;width:3px;height:3px;--d:6s;--dl:.5s;"></i>
          <i style="left:38%;top:12%;width:2px;height:2px;background:#fff;--d:4.8s;--dl:.9s;"></i>
          <i style="left:52%;top:82%;width:3px;height:3px;--d:5.2s;--dl:.3s;"></i>
          <i style="left:64%;top:16%;width:2px;height:2px;--d:6.2s;--dl:1.4s;"></i>
          <i style="left:78%;top:28%;width:3px;height:3px;background:#fff;--d:4.6s;--dl:.7s;"></i>
          <i style="left:84%;top:62%;width:2px;height:2px;--d:5.8s;--dl:.1s;"></i>
          <i style="left:88%;top:44%;width:3px;height:3px;--d:5s;--dl:1.2s;"></i>
          <i style="left:70%;top:82%;width:2px;height:2px;background:#fff;--d:6.4s;--dl:.6s;"></i>
          <i style="left:30%;top:38%;width:2px;height:2px;--d:5.4s;--dl:1.6s;"></i>
          <i style="left:8%;top:44%;width:2px;height:2px;background:#fff;--d:4.9s;--dl:.4s;"></i>
        </div>
        <div class="webinner">
          <div class="cloudwrap"><img class="cloud" src="assets/web-cloud.png" alt="Aether cloud"></div>
          <div class="weblabel">Aether AI<br>on <b>the web</b></div>
        </div>
      </a>

      <!-- platform & api -->
      <a class="tile t-platform" href="UVT Billing v2.html">
        <div class="lap"></div>
        <div class="platxt">
          <div class="label">Console · Account</div>
          <h2>Platform &amp; API</h2>
          <p>Keys, usage and deployments — plus your account, settings, billing &amp; UVT.</p>
        </div>
      </a>

      <!-- aether code & releases -->
      <a class="tile t-models t-code" href="Aether Code & Releases.html">
        <div class="code-art">
          <pre class="code-aether" aria-label="AETHER"> █████╗ ███████╗████████╗██╗  ██╗███████╗██████╗ 
██╔══██╗██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗
███████║█████╗     ██║   ███████║█████╗  ██████╔╝
██╔══██║██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗
██║  ██║███████╗   ██║   ██║  ██║███████╗██║  ██║
╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝</pre>
        </div>
        <div class="mhead">
          <h2>Aether Agent &amp; Models</h2>
          <span class="more">Releases &amp; install →</span>
        </div>
      </a>

      <!-- about -->
      <a class="tile t-about" href="https://aethersystems.net/about">
        <div class="stars">
          <i style="left:14%;top:16%;width:2px;height:2px;--d:4.7s;--dl:.3s;"></i>
          <i style="left:30%;top:24%;width:2px;height:2px;background:#fff;--d:5.6s;--dl:1.2s;"></i>
          <i style="left:78%;top:18%;width:2px;height:2px;--d:6.1s;--dl:.6s;"></i>
          <i style="left:86%;top:40%;width:3px;height:3px;background:#fff;--d:4.9s;--dl:.8s;"></i>
          <i style="left:8%;top:38%;width:2px;height:2px;--d:5.3s;--dl:.2s;"></i>
          <i style="left:64%;top:50%;width:2px;height:2px;background:#fff;--d:6.3s;--dl:1.5s;"></i>
        </div>
        <div class="globe">
          <div class="strip"></div>
          <div class="shade"></div>
        </div>
        <div class="aboutxt">
          <div class="label">Company</div>
          <h2>About Aether AI</h2>
          <p>Our mission, the team, and the systems behind the stack.</p>
        </div>
      </a>
    </div>

    <div class="footer">
      <span>© 2026 Aether AI</span>
      <span><a href="https://aethersystems.net/legal/terms">Terms</a> · <a href="https://aethersystems.net/legal/privacy">Privacy</a> · <a href="https://aethersystems.net/status">Status</a></span>
    </div>
  </div>

  


</body></html>