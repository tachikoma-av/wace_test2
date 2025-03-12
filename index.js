const { parseArgs } = require('node:util');

const { chromium } = require('playwright');
const fs = require('fs/promises');

async function getDorks(filename) {
  const TIME_KEY = `time_period`;
  const dorks_raw = await fs.readFile(filename, 'utf-8');
  const dorks = {

  };
  const lines = dorks_raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let key;
    let value;
    if (line.includes('after') || line.includes('before')){
      key = TIME_KEY;
      value = line.trim().split(`,`).map(el=>el.trim());
    } else {
      key = line.split(':')[0];
      value = line.split(':').slice(1).join(`:`).split(`,`).map(el=>el.trim());
    }
    dorks[key.trim()] = value;
  }

  const keys = Object.keys(dorks);

  function combine(index) {
      if (index === keys.length) return [''];
      const key = keys[index];
      const values = dorks[key];
      const combinations = combine(index + 1);

      return values.flatMap(value =>
          combinations.map(combo => {
            if (key == TIME_KEY){
              return `${value} ${combo}`.trim();
            } else {
              return `${key}:${value} ${combo}`.trim();
            }
          })
      );
  }

  const dorks_combinations = combine(0);
  return dorks_combinations;
}

function parseFirst(){
  try {
    const parent_selector = document.querySelector(`#search`).querySelector(`div`);
    let obj = null;
    if (parent_selector != null){
      let child_index = 0;
      if (parent_selector.querySelector(`div`).children[child_index].innerHTML == ''){
        child_index+=1;
      }
      let first_element = parent_selector.querySelector(`div`).children[child_index];
      let description_selector = null;
      if (first_element.querySelector(`em`) != null){
        description_selector = first_element.querySelector(`em`).parentElement;
      } else {
        description_selector = Array.from(first_element.children[0].children[0].children[0].children).slice(-1)[0];
      }
      obj = {
        header:first_element.querySelector(`h3`).textContent,
        description: description_selector.textContent,
        url:first_element.querySelector(`a`).href,
      }
    }
    return obj;
  } catch (error) {
    console.log(error);
    return null;    
  }
}
// parseFirst();



class Agent {
  constructor() {
    this.initialized = false;
    this.initialize();
  }
  async initialize() {
    this.browser = await chromium.launch({
      headless: false,
    });
    this.page = await this.browser.contexts()[0].newPage();
    this.initialized = true;
  }
  async waitTillInitialized(){
    while (!this.initialized){
      console.log(`Waiting for initialization...`)
      await new Promise(resolve => setTimeout(resolve, 1000))
    };
  }
  async parseQuery(query) {
    console.log(`[Agent.parseQuery] ${query}`);
    let page = this.page;
    let page_url = page.url();
    switch (page_url) {
      case 'about:blank':
        await page.goto(`https://www.google.com/search?q=${query}`);
        break;
    
      default:
        let coord_orig = await page.evaluate( ()=>{
          const element = document.querySelector(`[action="/search"]`);
          // Get the element's position relative to the document
          const rect = element.getBoundingClientRect();
          const x = rect.left + window.scrollX;
          const y = rect.top + window.scrollY;
          return [x,y]
        })
        await page.mouse.click(coord_orig[0]+25, coord_orig[1]+25)
        await new Promise(r => setTimeout(r, 2000));
        await page.keyboard.press('Control+A');
        await new Promise(r => setTimeout(r, 1000));
        await page.keyboard.press('Backspace');
        await new Promise(r => setTimeout(r, 1000));
        await page.keyboard.type(query);
        await page.keyboard.press('Enter');
        while (true) {
          let current_url = page.url();
          if (current_url != page_url){
            break;
          }
          console.log('[Agent.ParseQuery] waiting till next page')
          await new Promise(r => setTimeout(r, 1000));
        }
        break;
    }
    let _i = 0;
    while (true){
      _i += 1;
      if (_i > 10){
        console.log('[Agent.ParseQuery] query not found')
        return null;
      }
      let obj = await page.evaluate(parseFirst);
      if (obj == null){
          console.log('[Agent.ParseQuery] retrying parse in 1000ms')
          await new Promise(r => setTimeout(r, 1000));
          continue;
      }
      return obj;
    }
  }
  async shutdown() {
    console.log('[Agent.shutdown] shutting down')
    await this.page.close();
    await this.browser.close();
  }
}

class FileWriter {
  constructor(filename) {
    this.filename = filename
    this._i = 1;
  }
  async customInit() {
    let header = `| №  | Google Dork запрос                                    | Заголовок страницы           | URL                                  | Описание (Snippet)                       | Степень риска | Статус отправки        | Куда направлено | Дата формирования     |
|----|--------------------------------------------------------|------------------------------|---------------------------------------|-------------------------------------------|---------------|------------------------|-----------------|------------------------|\n`

    await fs.writeFile(this.filename, header, {"flag": "w"});
  }
  async write(data) {
    await fs.writeFile(this.filename, `| ${this._i} | ${data.query} | ${data.header} | ${data.url} | ${data.description} | | | | |\n`, {"flag": "a+"});
    this._i += 1;
  }
}

async function main() {
  const options = {
    'logfile': { type: 'string' },
    'file': { type: 'string' },
  };
  const { values, tokens } = parseArgs({ options, tokens: true });
  let dorks_path = values.file ?? `queries.txt`;
  let output_path = values.output ?? `output_raw.md`;

  let dorks_combinations = await getDorks(dorks_path);
  console.log(`[main] parsed dorks_combinations: ${dorks_combinations.map(el=> el)}`);
 
  let file_writer = new FileWriter(output_path);
  await file_writer.customInit();

  const agent = new Agent();
  await agent.waitTillInitialized();
 
  dorks_combinations = [
    `рестораны москвы`,
    `intext:"Рестораны Кемерово" site:*.su intitle:"Роллы" inurl:"forum" filetype:pdf define:препарат before:2019`,
    `сантехника в питере`,
    `магазин в гатовске`,
    `кафе в москве`,
  ]
  console.log(`[main] overriden dorks_combinations: ${JSON.stringify(dorks_combinations)}`);
  for (const dork of dorks_combinations){
    const res = await agent.parseQuery(dork);
    if (res != null){
      res.query = dork;
      await file_writer.write(res);
    }
    console.log(res);
    let min = 10;
    let max = 20;
    let delay_ms = Math.floor((Math.random() * (max - min) + min)) * 1000;
    console.log(`[main] delay_ms: ${delay_ms}`);
  await new Promise(r => setTimeout(r, delay_ms));
  }
  await agent.shutdown();

}

main();