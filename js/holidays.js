/**
 * 日本の祝日を計算で求めるファイル（現在の祝日法に基づく）
 *
 * 祝日の一覧を手で入力するのではなく、年ごとに計算するので、数年先の日付でも祝日を表示できる。
 * 法律の改正などで特別に決まった祝日は、計算では求められないため、EXCEPTIONS に追加する。
 */
(function (App) {
  'use strict';

  const { toDateStr, addDays } = App.DateUtils;

  // 月日が決まっている祝日（2020年以降の祝日法）
  const FIXED = [
    [1, 1, '元日'],
    [2, 11, '建国記念の日'],
    [2, 23, '天皇誕生日'],
    [4, 29, '昭和の日'],
    [5, 3, '憲法記念日'],
    [5, 4, 'みどりの日'],
    [5, 5, 'こどもの日'],
    [8, 11, '山の日'],
    [11, 3, '文化の日'],
    [11, 23, '勤労感謝の日'],
  ];

  // ハッピーマンデー（第n月曜日）
  const HAPPY_MONDAY = [
    [1, 2, '成人の日'],
    [7, 3, '海の日'],
    [9, 3, '敬老の日'],
    [10, 2, 'スポーツの日'],
  ];

  /**
   * 例外の一覧（特別措置法などで移動・追加された祝日）
   * remove: 取り消す通常の祝日の日付　add: 代わりに追加する日付と祝日名
   */
  const EXCEPTIONS = {
    2020: { remove: ['2020-07-20', '2020-08-11', '2020-10-12'], add: { '2020-07-23': '海の日', '2020-07-24': 'スポーツの日', '2020-08-10': '山の日' } },
    2021: { remove: ['2021-07-19', '2021-08-11', '2021-10-11'], add: { '2021-07-22': '海の日', '2021-07-23': 'スポーツの日', '2021-08-08': '山の日' } },
  };

  function nthMonday(year, month, n) {
    const first = new Date(year, month - 1, 1);
    const offset = (8 - first.getDay()) % 7; // 最初の月曜日までの日数
    return new Date(year, month - 1, 1 + offset + (n - 1) * 7);
  }

  // 春分・秋分の日（1980〜2099年に使える近似式。国立天文台の公表値と一致する）
  function vernalEquinoxDay(year) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  function autumnalEquinoxDay(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  const cache = new Map();

  /** その年の祝日を Map（"YYYY-MM-DD" → 祝日名）で返す */
  function holidaysOfYear(year) {
    if (cache.has(year)) return cache.get(year);
    const map = new Map();

    FIXED.forEach(([m, d, name]) => map.set(toDateStr(new Date(year, m - 1, d)), name));
    HAPPY_MONDAY.forEach(([m, n, name]) => map.set(toDateStr(nthMonday(year, m, n)), name));
    map.set(toDateStr(new Date(year, 2, vernalEquinoxDay(year))), '春分の日');
    map.set(toDateStr(new Date(year, 8, autumnalEquinoxDay(year))), '秋分の日');

    const ex = EXCEPTIONS[year];
    if (ex) {
      ex.remove.forEach((d) => map.delete(d));
      Object.entries(ex.add).forEach(([d, name]) => map.set(d, name));
    }

    // 国民の休日：前日と翌日が祝日である平日（祝日でない日）
    const base = [...map.keys()];
    base.forEach((str) => {
      const [y, m, d] = str.split('-').map(Number);
      const next = addDays(new Date(y, m - 1, d), 1);
      const afterNext = addDays(next, 1);
      const nextStr = toDateStr(next);
      if (!map.has(nextStr) && map.has(toDateStr(afterNext)) && next.getDay() !== 0) {
        map.set(nextStr, '国民の休日');
      }
    });

    // 振替休日：祝日が日曜日のとき、その後の最初の「祝日でない日」が休日になる
    [...map.keys()].sort().forEach((str) => {
      const [y, m, d] = str.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      if (date.getDay() !== 0) return;
      let sub = addDays(date, 1);
      while (map.has(toDateStr(sub))) sub = addDays(sub, 1);
      if (sub.getFullYear() === year) map.set(toDateStr(sub), '振替休日');
    });

    cache.set(year, map);
    return map;
  }

  /** 祝日なら名前、祝日でなければ null */
  function holidayName(date) {
    return holidaysOfYear(date.getFullYear()).get(toDateStr(date)) || null;
  }

  App.Holidays = { holidaysOfYear, holidayName };
})(window.TodoApp = window.TodoApp || {});
