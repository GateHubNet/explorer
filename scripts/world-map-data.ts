// The data of the world map (scripts/world-map-core.ts draws it, scripts/world-map.ts writes the two generated files): the land and water outlines the dots are sampled from, the
// 250 countries' points, and the board's 55. From E13 on this file is the source; it was ported from the mock kit's `worldmap.py`, which is not in the repository.
//
// - `LAND` and `WATER` are the kit's rough polygons ([lon, lat]), copied as they are. The kit gives them no origin or licence (for the owner).
// - `COUNTRY_POINTS` is [code, name, lat, lon] for the 250 codes the data API accepts (the 249 ISO 3166-1 alpha-2 codes assigned on 2026-10-24, and `XK`), sorted by code.
//   Names are the CLDR English names as `new Intl.DisplayNames(["en"], { type: "region" }).of(code)` gives them under Node 24, with the short forms "Hong Kong", "Macao",
//   "Palestine" and "Myanmar" for HK, MO, PS and MM. Points are, in this order of preference:
//     1. the board's 55 hub points, the kit's (`BOARD_CODES`, in the kit's order);
//     2. for ten codes the Factbook has no entry of its own for (AX, BQ, GF, GP, MQ, RE, YT) or only inside another's (PS, UM, SJ): the points the plan fixes;
//     3. the World Factbook's coordinates as the factbook/factbook.json mirror holds them (CC0, commit 144d6977), the CIA's own pages having been withdrawn.
//        The commit is 144d6977b2b01ac1cbd220de754c0a005616760b; the field is "Geographic coordinates" of an entry's "Geography". Each code is matched to the entry that names its
//        country (the entry's own "Country name", short or long form): the mirror's file names are FIPS codes, not ISO ones (`gm` is Germany, `ni` Nigeria), so a file name
//        is never used; where the entry's name is not the CLDR one, the line says what it is called there. Degrees and minutes are read as degrees + minutes / 60, to two
//        decimals, south and west negative; an entry that lists several places gives the first.

export const LAND: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  north_america: [[-156.5, 71.3], [-151, 70.4], [-141, 69.6], [-133, 69.5], [-128, 70.2], [-120, 69.3], [-114, 68.4], [-108, 68.2], [-102, 67.8], [-98, 68], [-94.5, 69.3], [-90.5, 68.4], [-87, 67.3], [-89, 64], [-93, 61], [-94.5, 59], [-92.5, 57], [-88, 56.5], [-85, 55.2], [-82, 52.9], [-79.5, 51.5], [-79, 55], [-77.5, 57], [-77.8, 60], [-78, 62.3], [-74, 62.2], [-71, 61], [-69.5, 59], [-67, 58.4], [-65, 60.3], [-64, 58], [-61.5, 56], [-57.5, 53.8], [-55.7, 52.3], [-57, 51.5], [-60, 50.2], [-66, 50], [-70, 48], [-65, 48.6], [-64.5, 47], [-61, 46], [-60, 45.5], [-66, 43.5], [-70, 43.7], [-70.5, 41.7], [-74, 40.5], [-76, 39], [-75.5, 37.5], [-76.3, 35], [-77.9, 34], [-81, 31.5], [-80, 27], [-80.3, 25.3], [-81.8, 26], [-82.8, 28], [-84, 30], [-86, 30.4], [-89.5, 30.2], [-89.3, 29], [-91, 29.3], [-94, 29.6], [-97.3, 27.5], [-97.5, 25], [-97.7, 22], [-95.5, 18.8], [-94, 18.2], [-91, 18.8], [-90.5, 21], [-87, 21.5], [-87.6, 18.5], [-88.2, 16], [-86, 15.9], [-83.3, 15], [-83.6, 11], [-81.8, 9], [-79.5, 9.5], [-77.4, 8.5], [-78.4, 8], [-80.3, 7.4], [-82, 8.2], [-84, 9.5], [-85.7, 10.8], [-87.5, 13], [-91.5, 14], [-94, 16], [-96.5, 15.7], [-101, 17.3], [-105.5, 20.3], [-105.5, 22.5], [-108.5, 25.5], [-111, 28], [-112.8, 31.5], [-114.8, 31.8], [-113, 29], [-110.5, 24.5], [-109.9, 22.9], [-112, 24.8], [-115, 28], [-116.5, 31.5], [-117.1, 32.5], [-118.5, 34], [-120.6, 34.6], [-122.5, 37.5], [-124, 40.4], [-124.6, 43], [-124, 46.3], [-124.7, 48.4], [-123, 49], [-126, 50], [-128, 51.5], [-130.5, 54.5], [-133, 57], [-136.5, 58.5], [-140, 59.8], [-145, 60.3], [-148, 60.5], [-151.5, 59.2], [-154, 58], [-158, 57], [-162.5, 55], [-164.5, 54.6], [-161, 56], [-157.5, 58.6], [-162, 58.6], [-164, 60], [-165.5, 62], [-164.5, 63.2], [-161, 64.5], [-165, 64.5], [-168, 65.6], [-164, 66.5], [-162, 66.8], [-163.7, 68.2], [-166.2, 68.9], [-162, 70.2]],
  baffin: [[-90, 72], [-80, 73.7], [-70, 70.5], [-62, 66.5], [-64.5, 63.5], [-68, 62], [-72, 63.5], [-78, 64.3], [-74, 66.5], [-81, 69], [-85, 70]],
  victoria: [[-118, 69], [-101, 69], [-101, 73], [-114, 73]],
  devon: [[-125, 72], [-117, 75.5], [-105, 76.5], [-92, 76.5], [-80, 76.5], [-80, 74.5], [-92, 74.5], [-110, 74.5], [-123, 71.5]],
  greenland: [[-73, 78], [-66, 76], [-58, 75.5], [-56, 72.5], [-53.5, 70], [-51, 68.5], [-53.5, 66.5], [-50.5, 63], [-48.5, 61], [-44, 59.8], [-42, 61.5], [-40, 64.5], [-35, 66], [-31, 68.3], [-24, 70], [-21.8, 72.5], [-18.5, 75], [-18.5, 78], [-20, 82], [-40, 83.5], [-60, 82]],
  newfoundland: [[-59.3, 47.6], [-56, 51.6], [-55.5, 49.8], [-52.7, 47.5], [-53.6, 46.6]],
  cuba: [[-85, 21.9], [-82, 23.2], [-77, 22.2], [-74.2, 20.2], [-77.7, 19.9], [-80, 21.8]],
  hispaniola: [[-74.4, 18.5], [-72.8, 19.9], [-70, 19.7], [-68.4, 18.6], [-71.4, 17.6]],
  south_america: [[-80, 10], [-75, 11], [-71, 12], [-63, 10.5], [-60, 8], [-52, 5], [-50, 0], [-44, -2], [-35, -5], [-35, -9], [-39, -14], [-39, -18], [-41, -22], [-48, -26], [-48.5, -28], [-53, -34], [-58, -35], [-57, -38], [-62, -39], [-65, -42], [-65, -46], [-68, -50], [-69, -52], [-68.5, -55], [-71, -54], [-74, -50], [-75, -45], [-73.5, -38], [-71.5, -30], [-70.5, -18], [-75, -15], [-77, -12], [-81, -6], [-80, -1], [-78, 2], [-77, 7]],
  eurasia: [[-9.5, 37], [-9.5, 43.5], [-1.5, 43.5], [-1.5, 46], [-4.5, 48], [-1.5, 49.5], [1.5, 50.5], [4, 51.5], [5, 53], [8.5, 54], [8, 57], [10.5, 57.7], [10.5, 55], [12.5, 54.5], [14, 54], [19, 54.5], [21, 55.5], [21, 57], [24, 57.5], [24, 59.4], [29, 60], [23, 60], [21.5, 61], [21.5, 63.5], [25, 65], [22, 65.8], [17.5, 62.5], [19, 60], [16.5, 57], [14.5, 56], [12.5, 56], [11, 58.5], [10.5, 59.5], [8, 58], [5.5, 58.8], [5, 62], [10, 64], [14, 67.5], [17, 69.5], [23, 70.5], [28, 71], [31, 70], [33, 69.3], [41, 67], [37, 66], [34.5, 64.5], [37, 64], [44, 66], [44, 68.5], [53, 68.5], [60, 69.5], [68, 68.5], [69, 73], [73, 72.5], [74, 69], [80, 73.5], [87, 75], [100, 76], [104, 77.7], [113, 76], [113, 73.5], [130, 71], [140, 72.5], [150, 71.5], [160, 70], [170, 70], [180, 69], [180, 65], [178, 64.5], [173, 61], [163, 60], [163, 58], [156.5, 51], [156, 57], [160, 61], [155, 59.5], [143, 59.5], [137, 54], [141, 53], [140, 48], [135, 43.5], [131, 42.5], [129.5, 40], [129, 35], [126.5, 34.5], [126.3, 37.5], [124.5, 39.8], [121.5, 40.8], [118, 39], [119, 37.2], [122.5, 37.4], [120, 35], [121, 32], [122, 30], [119.5, 25], [115, 22.5], [110, 21], [108, 21.5], [106, 19], [109, 15], [109, 11.5], [105, 8.6], [104.8, 10.5], [102, 12.5], [100.8, 13.5], [100, 10], [100.3, 7], [102.5, 6], [103.5, 4], [104.2, 1.4], [101, 2.8], [100, 5], [98.3, 8], [98.5, 10], [97.8, 15], [97.5, 17], [94.5, 16], [94.2, 19], [92.5, 21.5], [90, 22], [87, 21.5], [86, 20], [84, 18], [80, 15], [80, 10], [77.5, 8], [76, 10], [73.5, 16], [72.7, 21], [70, 21], [68.5, 23.5], [66.5, 25.3], [61.5, 25.2], [57, 25.8], [56.3, 26.5], [56.3, 24], [59.8, 22.5], [57.5, 18.9], [55, 17], [52, 15.5], [48, 14], [43.5, 12.7], [42.5, 15], [39, 21.5], [35, 28], [34.5, 29.5], [32.5, 30], [32.3, 31.2], [34.3, 31.3], [35, 33], [35.8, 35.5], [36, 36.8], [34, 36.2], [30, 36.3], [27.3, 37], [26.3, 39.2], [26.2, 40.5], [26, 40.8], [24, 40.5], [23.5, 38], [22.5, 36.5], [21.5, 37], [20.5, 39.5], [19.5, 41.5], [18.5, 42.5], [15.5, 44], [13.6, 45.6], [12.3, 45.3], [12.5, 44], [14, 42], [16, 41.5], [18.5, 40], [16.5, 38.5], [15.7, 38], [16, 39.5], [15.5, 40], [12, 41.8], [10.5, 43], [8.8, 44.4], [7.5, 43.8], [6, 43], [4, 43.5], [3.2, 42.5], [3, 41.8], [0.8, 41], [0, 39.5], [-0.5, 38.3], [-2, 36.7], [-5.5, 36], [-6.5, 36.8], [-8.8, 37]],
  great_britain: [[-5.7, 50], [1.5, 51], [1.7, 52.7], [0, 53.5], [-1.5, 55], [-2, 57.6], [-3.5, 58.6], [-5, 58.6], [-6.2, 56.6], [-5.5, 55.3], [-3, 54.8], [-3.4, 53.4], [-4.7, 52.8], [-5.3, 51.8], [-3, 51.4]],
  ireland: [[-10, 51.6], [-6, 52], [-6, 54], [-7.3, 55.3], [-8.5, 55.2], [-10, 54.2]],
  iceland: [[-24, 65.5], [-22, 66.4], [-16, 66.5], [-13.6, 65], [-15, 64.3], [-18.7, 63.4], [-22.7, 63.8]],
  sicily: [[12.4, 38], [15.6, 38.3], [15.1, 36.7]],
  africa: [[-17, 21], [-16, 24], [-13, 27.5], [-10, 29.5], [-9.5, 32.5], [-6.5, 34], [-5.5, 35.8], [-2, 35.1], [1, 36.5], [5, 36.8], [10, 37.3], [11, 36.8], [10, 34.5], [11, 33.2], [15, 32.3], [19, 30.3], [20, 32], [23, 32.6], [25, 31.7], [29, 30.9], [32.3, 31.2], [32.5, 30], [33.5, 27.5], [35.5, 24], [37.2, 21], [38.5, 18], [39.5, 15.5], [42.5, 13], [43.3, 11.5], [44.5, 10.4], [51, 11.8], [51, 10.5], [49, 6], [47, 4], [43, -1], [40.5, -2.5], [39, -6], [39.5, -10], [40.5, -14.5], [37, -17.5], [35.3, -22], [35.5, -24], [32.8, -26], [32.5, -29], [30, -31.3], [27.5, -33.5], [25, -34], [22, -34.2], [20, -34.8], [18.4, -34], [18, -32], [16.5, -28.6], [15, -26.5], [14.4, -23], [13, -20], [11.8, -17], [12, -13], [13.5, -11], [13, -8.5], [12.2, -6], [11.8, -3.5], [9, -1], [9.5, 1], [9.7, 3.5], [8.5, 4.5], [6, 4.3], [4.5, 6.3], [2, 6.2], [-2, 4.8], [-4.5, 5.2], [-7.5, 4.3], [-9.5, 5.4], [-11.5, 6.9], [-13.3, 8.5], [-15, 10.8], [-16.7, 12.5], [-17.5, 14.7], [-16.5, 16.5], [-16, 19]],
  madagascar: [[44, -25], [47, -25], [49.5, -17], [50.5, -15.5], [49.3, -12], [47, -14], [44.4, -16.5], [43.6, -21.5]],
  sri_lanka: [[79.8, 8], [80.2, 9.8], [81.9, 7.5], [81, 6], [80, 6.2]],
  japan: [[130, 31], [131.5, 31.4], [132, 33.8], [135, 33.5], [137, 34.5], [140, 35], [141, 38], [142, 39.5], [141.4, 41.4], [140, 40.5], [139.5, 38], [137, 37], [135.5, 35.6], [132.5, 35.5], [130.9, 34]],
  hokkaido: [[140, 42], [141.5, 42.5], [143.5, 42], [145.5, 43.3], [142, 45.4], [140, 43.3]],
  sakhalin: [[142, 46], [143.5, 46.5], [143, 50], [143.2, 54], [142.5, 54.3], [142, 50]],
  taiwan: [[120.2, 22.6], [121, 22], [122, 25], [121.5, 25.3]],
  luzon: [[120, 18.5], [122.3, 18.5], [122, 16], [124, 13.8], [121, 13.8], [120, 16]],
  visayas: [[122, 10], [122, 11.6], [125, 12.4], [125.5, 10], [123.5, 9.3]],
  mindanao: [[122, 7], [126.5, 7], [126.2, 9.5], [125, 9], [123, 8.5]],
  sumatra: [[95.3, 5.6], [97.5, 5.2], [100.5, 2], [103.8, -1], [106, -3], [105.8, -5.8], [104.5, -5.8], [102, -4], [100, -1], [98.5, 1.7], [96, 3.8]],
  java: [[105.2, -6.8], [108, -6.3], [111, -6.5], [114.5, -7.7], [114.4, -8.7], [110, -8.1], [106, -7.4]],
  borneo: [[109, 1.5], [110, 1.7], [111, 2.8], [113.5, 4], [115.5, 5.2], [117, 7], [119, 5], [118, 4.3], [117.5, 1], [118.8, 1], [117, -1], [116.5, -3.5], [114.5, -3.8], [111, -3], [110, -1.8], [109, 0]],
  sulawesi: [[119, -5.5], [120.5, -5.5], [120.5, -2.5], [121.5, -1], [123, -0.8], [125, 1.5], [124.5, 0.5], [120.5, 0.5], [119.8, -0.5], [119, -3]],
  new_guinea: [[131, -1], [134, -0.8], [137, -1.5], [141, -2.6], [145.7, -4.8], [148, -8], [150.5, -10.5], [147, -10], [144, -7.7], [141, -9.2], [138.5, -8.3], [137.8, -5.3], [135, -4.3], [132.5, -4]],
  australia: [[113.5, -22], [114, -26.5], [115, -34], [117.5, -35], [123, -33.8], [126, -32.3], [131, -31.5], [134, -32.8], [137.5, -35.5], [138, -33], [140, -38], [144, -38.3], [146.5, -39], [150, -37.5], [153, -32], [153.5, -28], [153, -25], [150.5, -22.5], [146.5, -19], [145.4, -15], [143.5, -14], [142.5, -10.7], [141.5, -13], [141.5, -17], [140, -17.7], [136, -15], [136.7, -12.2], [132.5, -11.4], [130, -13], [129, -14.9], [126, -14], [122.5, -17], [121, -19.5], [117, -20.7]],
  tasmania: [[144.6, -40.7], [148.3, -40.9], [148, -43.2], [146, -43.6]],
  nz_north: [[172.7, -34.4], [174.5, -36], [176, -37.5], [178.5, -37.7], [177, -39.5], [176, -41.3], [174.8, -41.3], [175, -39.5], [173.8, -39.2], [174.5, -37]],
  nz_south: [[172.7, -40.5], [174.2, -41.6], [173, -43.5], [171, -44.7], [169, -46.6], [166.5, -46], [168, -44], [170.5, -42.7]],
};
export const WATER: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  caspian: [[47, 44.5], [50, 46.5], [53, 47], [54, 45], [51, 44.3], [53, 42], [52.8, 40.5], [54, 37.3], [51, 36.6], [49, 38], [49.5, 40.3], [47.5, 42.5]],
  black_sea: [[28, 41.2], [28.5, 43.5], [30, 45.5], [31, 46.6], [33.5, 46], [35, 45.3], [36.5, 45.4], [38, 47], [39.5, 47], [38, 45], [37.5, 44.5], [40, 43.4], [41.6, 41.6], [38, 40.9], [35, 42], [33, 42], [31, 41.2]],
  persian_gulf: [[48, 30], [50, 29.8], [51, 28], [53, 27], [56.3, 26.6], [56.3, 25], [54, 24], [52, 24], [51, 25.5], [50.3, 26.5], [49, 27.5]],
};

/** [code, name, lat, lon] for the 250 codes, sorted by code. */
export const COUNTRY_POINTS: readonly (readonly [code: string, name: string, lat: number, lon: number])[] = [
  ["AD", "Andorra", 42.5, 1.5],
  ["AE", "United Arab Emirates", 24.3, 54.3],
  ["AF", "Afghanistan", 33, 65],
  ["AG", "Antigua & Barbuda", 17.05, -61.8], // Factbook: "Antigua and Barbuda"
  ["AI", "Anguilla", 18.25, -63.17],
  ["AL", "Albania", 41, 20],
  ["AM", "Armenia", 40, 45],
  ["AO", "Angola", -12.5, 18.5],
  ["AQ", "Antarctica", -90, 0],
  ["AR", "Argentina", -35.4, -65.2],
  ["AS", "American Samoa", -14.33, -170],
  ["AT", "Austria", 47.6, 14.1],
  ["AU", "Australia", -25.3, 133.8],
  ["AW", "Aruba", 12.5, -69.97],
  ["AX", "Åland Islands", 60.2, 19.9], // no Factbook entry of its own
  ["AZ", "Azerbaijan", 40.5, 47.5],
  ["BA", "Bosnia & Herzegovina", 44, 18], // Factbook: "Bosnia and Herzegovina"
  ["BB", "Barbados", 13.17, -59.53],
  ["BD", "Bangladesh", 24, 90],
  ["BE", "Belgium", 50.6, 4.6],
  ["BF", "Burkina Faso", 13, -2],
  ["BG", "Bulgaria", 43, 25],
  ["BH", "Bahrain", 26, 50.55],
  ["BI", "Burundi", -3.5, 30],
  ["BJ", "Benin", 9.5, 2.25],
  ["BL", "St. Barthélemy", 17.9, -62.85], // Factbook: "Saint Barthelemy"; the entry gives "17 90 N, 62 85 W": 90 and 85 cannot be minutes, so they are read as hundredths of a degree
  ["BM", "Bermuda", 32.33, -64.75],
  ["BN", "Brunei", 4.5, 114.67],
  ["BO", "Bolivia", -17, -65],
  ["BQ", "Caribbean Netherlands", 12.2, -68.3], // no Factbook entry of its own
  ["BR", "Brazil", -10.8, -52.9],
  ["BS", "Bahamas", 24.25, -76], // Factbook: "The Bahamas"
  ["BT", "Bhutan", 27.5, 90.5],
  ["BV", "Bouvet Island", -54.43, 3.4],
  ["BW", "Botswana", -22, 24],
  ["BY", "Belarus", 53, 28],
  ["BZ", "Belize", 17.25, -88.75],
  ["CA", "Canada", 54, -100],
  ["CC", "Cocos (Keeling) Islands", -12.5, 96.83],
  ["CD", "Congo - Kinshasa", 0, 25], // Factbook: "DRC"
  ["CF", "Central African Republic", 7, 21],
  ["CG", "Congo - Brazzaville", -1, 15], // Factbook: "Congo (Brazzaville)"
  ["CH", "Switzerland", 46.8, 8.2],
  ["CI", "Côte d’Ivoire", 8, -5], // Factbook: "Côte d'Ivoire"
  ["CK", "Cook Islands", -21.23, -159.77],
  ["CL", "Chile", -33.5, -70.7],
  ["CM", "Cameroon", 6, 12],
  ["CN", "China", 35, 104],
  ["CO", "Colombia", 4.6, -74.1],
  ["CR", "Costa Rica", 10, -84],
  ["CU", "Cuba", 21.5, -80],
  ["CV", "Cape Verde", 16, -24], // Factbook: "Cabo Verde"
  ["CW", "Curaçao", 12.17, -69], // Factbook: "Curacao"
  ["CX", "Christmas Island", -10.5, 105.67],
  ["CY", "Cyprus", 35, 33],
  ["CZ", "Czechia", 49.8, 15.5],
  ["DE", "Germany", 51.2, 10.4],
  ["DJ", "Djibouti", 11.5, 43],
  ["DK", "Denmark", 56, 9.5],
  ["DM", "Dominica", 15.42, -61.33],
  ["DO", "Dominican Republic", 19, -70.67], // Factbook: "The Dominican"
  ["DZ", "Algeria", 28, 3],
  ["EC", "Ecuador", -2, -77.5],
  ["EE", "Estonia", 58.6, 25],
  ["EG", "Egypt", 26.8, 30.8],
  ["EH", "Western Sahara", 24.5, -13],
  ["ER", "Eritrea", 15, 39],
  ["ES", "Spain", 40.2, -3.6],
  ["ET", "Ethiopia", 8, 38],
  ["FI", "Finland", 62, 26],
  ["FJ", "Fiji", -18, 175],
  ["FK", "Falkland Islands", -51.75, -59], // Factbook: "Falkland Islands (Islas Malvinas)"
  ["FM", "Micronesia", 6.92, 158.25], // Factbook: "Federated States of Micronesia"
  ["FO", "Faroe Islands", 62, -7],
  ["FR", "France", 46.6, 2.4],
  ["GA", "Gabon", -1, 11.75],
  ["GB", "United Kingdom", 53, -1.8],
  ["GD", "Grenada", 12.12, -61.67],
  ["GE", "Georgia", 42, 43.5],
  ["GF", "French Guiana", 4, -53], // no Factbook entry of its own
  ["GG", "Guernsey", 49.47, -2.58],
  ["GH", "Ghana", 8, -2],
  ["GI", "Gibraltar", 36.13, -5.35],
  ["GL", "Greenland", 72, -40],
  ["GM", "Gambia", 13.47, -16.57], // Factbook: "The Gambia"
  ["GN", "Guinea", 11, -10],
  ["GP", "Guadeloupe", 16.3, -61.6], // no Factbook entry of its own
  ["GQ", "Equatorial Guinea", 2, 10],
  ["GR", "Greece", 39, 22],
  ["GS", "South Georgia & South Sandwich Islands", -54.5, -37], // Factbook: "South Georgia and South Sandwich Islands"
  ["GT", "Guatemala", 15.5, -90.25],
  ["GU", "Guam", 13.47, 144.78],
  ["GW", "Guinea-Bissau", 12, -15],
  ["GY", "Guyana", 5, -59],
  ["HK", "Hong Kong", 22.3, 114.2],
  ["HM", "Heard & McDonald Islands", -53.1, 72.52], // Factbook: "Heard Island and McDonald Islands"
  ["HN", "Honduras", 15, -86.5],
  ["HR", "Croatia", 45.17, 15.5],
  ["HT", "Haiti", 19, -72.42],
  ["HU", "Hungary", 47, 20],
  ["ID", "Indonesia", -2.5, 118],
  ["IE", "Ireland", 53.2, -8],
  ["IL", "Israel", 31.4, 35],
  ["IM", "Isle of Man", 54.25, -4.5],
  ["IN", "India", 21, 78],
  ["IO", "British Indian Ocean Territory", -6, 71.5],
  ["IQ", "Iraq", 33, 44],
  ["IR", "Iran", 32, 53],
  ["IS", "Iceland", 64.9, -18.6],
  ["IT", "Italy", 42.8, 12.6],
  ["JE", "Jersey", 49.25, -2.17],
  ["JM", "Jamaica", 18.25, -77.5],
  ["JO", "Jordan", 31, 36],
  ["JP", "Japan", 36.2, 138.3],
  ["KE", "Kenya", 0.2, 37.9],
  ["KG", "Kyrgyzstan", 41, 75],
  ["KH", "Cambodia", 13, 105],
  ["KI", "Kiribati", 1.42, 173],
  ["KM", "Comoros", -12.17, 44.25],
  ["KN", "St. Kitts & Nevis", 17.33, -62.75], // Factbook: "Saint Kitts and Nevis"
  ["KP", "North Korea", 40, 127],
  ["KR", "South Korea", 36.5, 127.9],
  ["KW", "Kuwait", 29.5, 45.75],
  ["KY", "Cayman Islands", 19.5, -80.5],
  ["KZ", "Kazakhstan", 48, 67],
  ["LA", "Laos", 18, 105],
  ["LB", "Lebanon", 33.83, 35.83],
  ["LC", "St. Lucia", 13.88, -60.97], // Factbook: "Saint Lucia"
  ["LI", "Liechtenstein", 47.27, 9.53],
  ["LK", "Sri Lanka", 7, 81],
  ["LR", "Liberia", 6.5, -9.5],
  ["LS", "Lesotho", -29.5, 28.5],
  ["LT", "Lithuania", 55.2, 23.9],
  ["LU", "Luxembourg", 49.8, 6.1],
  ["LV", "Latvia", 57, 25],
  ["LY", "Libya", 25, 17],
  ["MA", "Morocco", 28.5, -10],
  ["MC", "Monaco", 43.73, 7.4],
  ["MD", "Moldova", 47, 29],
  ["ME", "Montenegro", 42.5, 19.3],
  ["MF", "St. Martin", 18.08, -63.95], // Factbook: "Saint Martin"
  ["MG", "Madagascar", -20, 47],
  ["MH", "Marshall Islands", 9, 168],
  ["MK", "North Macedonia", 41.83, 22],
  ["ML", "Mali", 17, -4],
  ["MM", "Myanmar", 22, 98], // Factbook: "Burma"
  ["MN", "Mongolia", 46, 105],
  ["MO", "Macao", 22.17, 113.55], // Factbook: "Macau"
  ["MP", "Northern Mariana Islands", 15.2, 145.75],
  ["MQ", "Martinique", 14.7, -61], // no Factbook entry of its own
  ["MR", "Mauritania", 20, -12],
  ["MS", "Montserrat", 16.75, -62.2],
  ["MT", "Malta", 35.83, 14.58],
  ["MU", "Mauritius", -20.28, 57.55],
  ["MV", "Maldives", 3.25, 73],
  ["MW", "Malawi", -13.5, 34],
  ["MX", "Mexico", 23.6, -102.5],
  ["MY", "Malaysia", 4.2, 102],
  ["MZ", "Mozambique", -18.25, 35],
  ["NA", "Namibia", -22, 17],
  ["NC", "New Caledonia", -21.5, 165.5],
  ["NE", "Niger", 16, 8],
  ["NF", "Norfolk Island", -29.03, 167.95],
  ["NG", "Nigeria", 9.1, 8.7],
  ["NI", "Nicaragua", 13, -85],
  ["NL", "Netherlands", 52.2, 5.3],
  ["NO", "Norway", 61, 9],
  ["NP", "Nepal", 28, 84],
  ["NR", "Nauru", -0.53, 166.92],
  ["NU", "Niue", -19.03, -169.87],
  ["NZ", "New Zealand", -41, 174],
  ["OM", "Oman", 21, 57],
  ["PA", "Panama", 9, -80],
  ["PE", "Peru", -9.2, -75],
  ["PF", "French Polynesia", -15, -140],
  ["PG", "Papua New Guinea", -6, 147],
  ["PH", "Philippines", 12.9, 121.8],
  ["PK", "Pakistan", 30, 70],
  ["PL", "Poland", 52.1, 19.4],
  ["PM", "St. Pierre & Miquelon", 46.83, -56.33], // Factbook: "Saint Pierre and Miquelon"
  ["PN", "Pitcairn Islands", -25.07, -130.1],
  ["PR", "Puerto Rico", 18.25, -66.5],
  ["PS", "Palestine", 32, 35.25], // the West Bank entry
  ["PT", "Portugal", 39.6, -8],
  ["PW", "Palau", 7.5, 134.5],
  ["PY", "Paraguay", -23, -58],
  ["QA", "Qatar", 25.5, 51.25],
  ["RE", "Réunion", -21.1, 55.5], // no Factbook entry of its own
  ["RO", "Romania", 45.9, 24.9],
  ["RS", "Serbia", 44, 21],
  ["RU", "Russia", 61.5, 100],
  ["RW", "Rwanda", -2, 30],
  ["SA", "Saudi Arabia", 24, 45],
  ["SB", "Solomon Islands", -8, 159],
  ["SC", "Seychelles", -4.58, 55.67],
  ["SD", "Sudan", 15, 30],
  ["SE", "Sweden", 60.1, 15],
  ["SG", "Singapore", 1.35, 103.8],
  ["SH", "St. Helena", -15.95, -5.7], // Factbook: "Saint Helena, Ascension, and Tristan da Cunha"; the entry lists three places: the first, Saint Helena itself
  ["SI", "Slovenia", 46.12, 14.82],
  ["SJ", "Svalbard & Jan Mayen", 78, 20], // the Svalbard entry
  ["SK", "Slovakia", 48.67, 19.5],
  ["SL", "Sierra Leone", 8.5, -11.5],
  ["SM", "San Marino", 43.77, 12.42],
  ["SN", "Senegal", 14, -14],
  ["SO", "Somalia", 10, 49],
  ["SR", "Suriname", 4, -56],
  ["SS", "South Sudan", 8, 30],
  ["ST", "São Tomé & Príncipe", 1, 7], // Factbook: "Sao Tome and Principe"
  ["SV", "El Salvador", 13.83, -88.92],
  ["SX", "Sint Maarten", 18.07, -63.07],
  ["SY", "Syria", 35, 38],
  ["SZ", "Eswatini", -26.5, 31.5],
  ["TC", "Turks & Caicos Islands", 21.75, -71.58], // Factbook: "Turks and Caicos Islands"
  ["TD", "Chad", 15, 19],
  ["TF", "French Southern Territories", -37.83, 77.53], // Factbook: "French Southern and Antarctic Lands"; the entry lists nine places: the first, Ile Amsterdam
  ["TG", "Togo", 8, 1.17],
  ["TH", "Thailand", 15.9, 100.9],
  ["TJ", "Tajikistan", 39, 71],
  ["TK", "Tokelau", -9, -172],
  ["TL", "Timor-Leste", -8.83, 125.92],
  ["TM", "Turkmenistan", 40, 60],
  ["TN", "Tunisia", 34, 9],
  ["TO", "Tonga", -20, -175],
  ["TR", "Türkiye", 39, 35.2],
  ["TT", "Trinidad & Tobago", 11, -61], // Factbook: "Trinidad and Tobago"
  ["TV", "Tuvalu", -8, 178],
  ["TW", "Taiwan", 23.7, 121],
  ["TZ", "Tanzania", -6, 35],
  ["UA", "Ukraine", 49, 31.4],
  ["UG", "Uganda", 1, 32],
  ["UM", "U.S. Outlying Islands", 19.28, 166.6], // the Wake Island entry
  ["US", "United States", 39.8, -98.6],
  ["UY", "Uruguay", -33, -56],
  ["UZ", "Uzbekistan", 41, 64],
  ["VA", "Vatican City", 41.9, 12.45], // Factbook: "Holy See (Vatican City)"
  ["VC", "St. Vincent & Grenadines", 13.25, -61.2], // Factbook: "Saint Vincent and the Grenadines"
  ["VE", "Venezuela", 8, -66],
  ["VG", "British Virgin Islands", 18.5, -64.5],
  ["VI", "U.S. Virgin Islands", 18.33, -64.83], // Factbook: "Virgin Islands"
  ["VN", "Vietnam", 14.1, 108.3],
  ["VU", "Vanuatu", -16, 167],
  ["WF", "Wallis & Futuna", -13.3, -176.2], // Factbook: "Wallis and Futuna"
  ["WS", "Samoa", -13.58, -172.33],
  ["XK", "Kosovo", 42.58, 21],
  ["YE", "Yemen", 15, 48],
  ["YT", "Mayotte", -12.8, 45.2], // no Factbook entry of its own
  ["ZA", "South Africa", -29, 25],
  ["ZM", "Zambia", -15, 30],
  ["ZW", "Zimbabwe", -20, 30],
];

/** The board's 55 hub points' codes, in the kit's order. */
export const BOARD_CODES: readonly string[] = [
  "US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "GB", "IE", "IS",
  "PT", "ES", "FR", "BE", "NL", "LU", "DE", "CH", "AT", "IT", "DK",
  "NO", "SE", "FI", "EE", "LT", "PL", "CZ", "RO", "UA", "TR", "RU",
  "KZ", "IL", "SA", "AE", "EG", "NG", "KE", "ZA", "IN", "CN", "HK",
  "TW", "KR", "JP", "TH", "VN", "MY", "SG", "ID", "PH", "AU", "NZ",
];
