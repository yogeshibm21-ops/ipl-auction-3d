import { buildPlayerProfile, validateVerifiedStatRecords } from "./PlayerProfiles.js";
import { VERIFIED_STAT_RECORDS } from "./verifiedStats.js";

const groups = {
  batter: [
    "Virat Kohli", "Rohit Sharma", "Shubman Gill", "Suryakumar Yadav", "Yashasvi Jaiswal", "Ruturaj Gaikwad", "Shreyas Iyer", "KL Rahul", "Rinku Singh", "Shikhar Dhawan", "Prithvi Shaw", "Devdutt Padikkal", "Ajinkya Rahane", "Faf du Plessis", "David Warner", "Travis Head", "David Miller", "Shimron Hetmyer", "Dewald Brevis", "Tilak Varma", "Sai Sudharsan", "Rajat Patidar", "Rahul Tripathi", "Nitish Rana", "Manish Pandey", "Mayank Agarwal", "Karun Nair", "Sarfaraz Khan", "Abhishek Sharma", "Rahul Tewatia", "Shashank Singh", "Ashutosh Sharma", "Nehal Wadhera", "Angkrish Raghuvanshi", "Sameer Rizvi", "Rovman Powell", "Harry Brook", "Joe Root", "Kane Williamson", "Steve Smith", "Marnus Labuschagne", "Daryl Mitchell", "Aiden Markram", "Rassie van der Dussen", "Dawid Malan", "Tom Kohler-Cadmore", "Liam Dawson", "Prithvi Raj Yarra", "Anmolpreet Singh", "Abdul Samad", "Atharva Taide", "Venkatesh Iyer", "Rinku Singh", "Luvnith Sisodia", "Shahrukh Khan"
  ],
  wicketkeeper: [
    "Rishabh Pant", "Sanju Samson", "Ishan Kishan", "Heinrich Klaasen", "Jos Buttler", "Quinton de Kock", "Phil Salt", "Nicholas Pooran", "Jitesh Sharma", "Dhruv Jurel", "Wriddhiman Saha", "Dinesh Karthik", "Jonny Bairstow", "Rahmanullah Gurbaz", "Ryan Rickelton", "KS Bharat", "Anuj Rawat", "Vishnu Vinod", "Kusal Mendis", "Litton Das", "Matthew Wade", "Alex Carey", "Tom Banton", "Donovan Ferreira", "Robin Minz", "Prabhsimran Singh", "Abishek Porel", "N Jagadeesan", "Upendra Yadav", "Shai Hope", "Brandon McMullen", "Tom Latham", "Mushfiqur Rahim", "Ibrahim Zadran", "Ben McDermott", "Kumar Kushagra", "Srikar Bharat", "Kusal Perera", "Lorcan Tucker", "Andries Gous"
  ],
  allrounder: [
    "Hardik Pandya", "Ravindra Jadeja", "Axar Patel", "Washington Sundar", "Shivam Dube", "Ravichandran Ashwin", "Glenn Maxwell", "Marcus Stoinis", "Liam Livingstone", "Cameron Green", "Sam Curran", "Moeen Ali", "Andre Russell", "Sunil Narine", "Mitchell Marsh", "Rachin Ravindra", "Jason Holder", "Daryl Mitchell", "Deepak Hooda", "Vijay Shankar", "Krunal Pandya", "Rahul Tewatia", "Shahbaz Ahmed", "Harshal Patel", "Romario Shepherd", "Riyan Parag", "Nitish Kumar Reddy", "Abhishek Sharma", "Marco Jansen", "Wanindu Hasaranga", "Kyle Mayers", "Azmatullah Omarzai", "Aman Khan", "Venkatesh Iyer", "Shivam Mavi", "Rishi Dhawan", "Daniel Sams", "David Wiese", "James Neesham", "Sikandar Raza", "Shakib Al Hasan", "Jason Roy", "Saurabh Tiwary", "Kedar Jadhav", "Lalit Yadav", "Mahipal Lomror", "Anukul Roy", "Arjun Tendulkar", "Vijayakanth Viyaskanth", "Will Jacks"
  ],
  bowler: [
    "Jasprit Bumrah", "Mohammed Shami", "Mohammed Siraj", "Arshdeep Singh", "Bhuvneshwar Kumar", "Yuzvendra Chahal", "Kuldeep Yadav", "Rashid Khan", "Varun Chakravarthy", "Ravichandran Ashwin", "T Natarajan", "Avesh Khan", "Mukesh Kumar", "Deepak Chahar", "Shardul Thakur", "Umesh Yadav", "Ishant Sharma", "Harshit Rana", "Mayank Yadav", "Mohsin Khan", "Matheesha Pathirana", "Mustafizur Rahman", "Trent Boult", "Pat Cummins", "Mitchell Starc", "Kagiso Rabada", "Anrich Nortje", "Josh Hazlewood", "Lockie Ferguson", "Gerald Coetzee", "Jofra Archer", "Mark Wood", "Reece Topley", "Fazalhaq Farooqi", "Alzarri Joseph", "Naveen-ul-Haq", "Noor Ahmad", "Maheesh Theekshana", "Adam Zampa", "Rahul Chahar", "Ravi Bishnoi", "Sai Kishore", "Piyush Chawla", "Amit Mishra", "Sandeep Sharma", "Khaleel Ahmed", "Prasidh Krishna", "Akash Deep", "Kartik Tyagi", "Chetan Sakariya", "Umran Malik", "Kartikeya Singh", "M Siddharth", "Manav Suthar", "Shreyas Gopal", "Shahbaz Nadeem", "Suyash Sharma", "Vijaykumar Vyshak", "Yash Dayal", "Simarjeet Singh", "Kuldip Yadav", "Vaibhav Arora", "Akash Madhwal", "Tushar Deshpande", "Mukesh Choudhary", "Rajvardhan Hangargekar", "Rasikh Dar", "Lungi Ngidi", "Nuwan Thushara", "Dilshan Madushanka", "Tim Southee", "Jason Behrendorff", "Chris Woakes", "Olly Stone", "Billy Stanlake", "Andrew Tye", "Ben Dwarshuis", "Nathan Ellis", "Sean Abbott", "Dushmantha Chameera", "Oshane Thomas", "Tabraiz Shamsi", "Mujeeb Ur Rahman", "Imran Tahir", "Akeal Hosein", "Keshav Maharaj", "Rehan Ahmed", "Shivam Sharma", "Sakib Hussain", "Yudhvir Singh", "Prince Yadav"
  ]
};

const marqueeNames = new Set([
  "Virat Kohli", "Rohit Sharma", "Shubman Gill", "Suryakumar Yadav", "Yashasvi Jaiswal",
  "Rishabh Pant", "Sanju Samson", "Jos Buttler", "Heinrich Klaasen", "Hardik Pandya",
  "Ravindra Jadeja", "Glenn Maxwell", "Andre Russell", "Jasprit Bumrah", "Rashid Khan",
  "Pat Cummins", "Mitchell Starc", "Trent Boult", "Yuzvendra Chahal", "Kagiso Rabada"
]);
const premiumNames = new Set([
  "Ruturaj Gaikwad", "Shreyas Iyer", "KL Rahul", "Ishan Kishan", "Nicholas Pooran",
  "Phil Salt", "David Warner", "Travis Head", "David Miller", "Sam Curran",
  "Cameron Green", "Sunil Narine", "Axar Patel", "Kuldeep Yadav", "Mohammed Shami",
  "Mohammed Siraj", "Arshdeep Singh", "Bhuvneshwar Kumar", "Matheesha Pathirana",
  "Mitchell Marsh", "Liam Livingstone", "Marcus Stoinis", "Jofra Archer", "Josh Hazlewood"
]);
const overseasNames = new Set([
  "Faf du Plessis", "David Warner", "Travis Head", "David Miller", "Shimron Hetmyer", "Dewald Brevis",
  "Harry Brook", "Joe Root", "Kane Williamson", "Steve Smith", "Marnus Labuschagne", "Daryl Mitchell",
  "Aiden Markram", "Rassie van der Dussen", "Dawid Malan", "Tom Kohler-Cadmore", "Liam Dawson",
  "Rovman Powell", "Jos Buttler", "Quinton de Kock", "Heinrich Klaasen", "Phil Salt", "Nicholas Pooran",
  "Jonny Bairstow", "Rahmanullah Gurbaz", "Ryan Rickelton", "Kusal Mendis", "Litton Das", "Matthew Wade",
  "Alex Carey", "Tom Banton", "Donovan Ferreira", "Shai Hope", "Brandon McMullen", "Tom Latham",
  "Mushfiqur Rahim", "Ibrahim Zadran", "Ben McDermott", "Kusal Perera", "Lorcan Tucker", "Andries Gous",
  "Cameron Green", "Glenn Maxwell", "Marcus Stoinis", "Liam Livingstone", "Sam Curran", "Moeen Ali",
  "Andre Russell", "Sunil Narine", "Mitchell Marsh", "Rachin Ravindra", "Jason Holder", "Romario Shepherd",
  "Wanindu Hasaranga", "Kyle Mayers", "Azmatullah Omarzai", "James Neesham", "Sikandar Raza",
  "Shakib Al Hasan", "Daniel Sams", "David Wiese", "Vijayakanth Viyaskanth", "Rashid Khan", "Trent Boult",
  "Pat Cummins", "Mitchell Starc", "Kagiso Rabada", "Anrich Nortje", "Josh Hazlewood", "Lockie Ferguson",
  "Gerald Coetzee", "Jofra Archer", "Mark Wood", "Reece Topley", "Fazalhaq Farooqi", "Alzarri Joseph",
  "Naveen-ul-Haq", "Noor Ahmad", "Maheesh Theekshana", "Adam Zampa", "Mustafizur Rahman", "Lungi Ngidi",
  "Nuwan Thushara", "Dilshan Madushanka", "Tim Southee", "Jason Behrendorff", "Chris Woakes", "Olly Stone",
  "Billy Stanlake", "Andrew Tye", "Ben Dwarshuis", "Nathan Ellis", "Sean Abbott", "Dushmantha Chameera",
  "Oshane Thomas", "Tabraiz Shamsi", "Mujeeb Ur Rahman", "Imran Tahir", "Akeal Hosein", "Keshav Maharaj",
  "Rehan Ahmed"
]);

function categoryFor(name, role, sequence) {
  if (marqueeNames.has(name)) return `Marquee ${role}`;
  if (premiumNames.has(name)) return "Grade A";
  return sequence % 2 === 0 ? "Grade B" : "Grade C";
}

const allNames = new Set();
const rolesByName = new Map();
for (const [role, names] of Object.entries(groups)) {
  for (const name of names) {
    const listedRoles = rolesByName.get(name) ?? [];
    if (!listedRoles.includes(role)) listedRoles.push(role);
    rolesByName.set(name, listedRoles);
  }
}
let sequence = 0;
const basePlayers = Object.entries(groups).flatMap(([role, names]) => names.map((name, index) => {
  if (allNames.has(name)) return null;
  allNames.add(name);
  const isOverseas = overseasNames.has(name);
  const basePrice = index % 5 === 0 ? 200 : index % 3 === 0 ? 100 : 50;
  const rating = Math.max(55, Math.min(95, 66 + ((sequence * 17 + 11) % 29)));
  const id = `ipl-${String(++sequence).padStart(3, "0")}`;
  const listedRoles = rolesByName.get(name) ?? [role];
  const playerRole = listedRoles.includes("allrounder") ? "allrounder" :
    listedRoles.includes("wicketkeeper") ? "wicketkeeper" :
      listedRoles.includes("bowler") ? "bowler" : role;
  return {
    id,
    name,
    nationalityGroup: isOverseas ? "Overseas" : "India",
    nationalityStatus: "curated game classification; country and season eligibility unverified",
    isOverseas,
    role: playerRole,
    roleStatus: "curated simulation classification; role groups and season role are unverified",
    roleGroups: listedRoles,
    secondaryRoles: listedRoles.filter((listedRole) => listedRole !== playerRole),
    category: categoryFor(name, playerRole, sequence),
    basePrice,
    rating,
    ratingLabel: "Simulated game rating (not an official prediction)",
    capped: null,
    cappedStatus: "unknown; not verified against a specific season",
    age: null,
    historicalTeams: null,
    historicalStats: null,
    auctionEligibility: "not asserted",
    battingHand: null,
    bowlingStyle: null,
    secondaryRole: listedRoles.find((listedRole) => listedRole !== playerRole) ?? null,
    dataSource: "Curated real-cricketer name seed; historical season, role, and auction eligibility are not asserted",
    dataSeason: null,
    season2026FranchiseCode: null,
    season2026AssociationStatus: "unknown",
    season2026SquadStatus: "unknown",
    season2026TradeStatus: "unknown",
    season2026SourceName: null,
    season2026Source: null,
    originalFranchiseCode: null,
    originalFranchiseStatus: "unknown",
    previousFranchiseCode: null,
    previousFranchiseStatus: "unknown",
    retentionEligible: false,
    auctionStatus: "unknown",
    currentOwner: null,
    basePriceStatus: "simulated",
    portrait: null,
    portraitStatus: "unavailable; local initials fallback"
  };
})).filter(Boolean);

export const IPL_2026_RETAINED_SOURCE = "https://www.iplt20.com/news/article/tata-ipl-2026-player-retentions-announced";

const retainedNamesByTeam = {
  CSK: "Anshul Kamboj,Gurjapneet Singh,*Jamie Overton,MS Dhoni,Mukesh Choudhary,*Nathan Ellis,*Noor Ahmad,Ramakrishna Ghosh,Sanju Samson (T),Ruturaj Gaikwad,Shivam Dube,Shreyas Gopal,Syed Khaleel Ahmed,Ayush Mhatre,*Dewald Brevis,Urvil Patel",
  DC: "Abhishek Porel,Ajay Mandal,Ashutosh Sharma,Axar Patel,*Dushmantha Chameera,Karun Nair,KL Rahul,Kuldeep Yadav,Madhav Tiwari,*Mitchell Starc,Mukesh Kumar,Nitish Rana (T),Sameer Rizvi,T. Natarajan,Tripurana Vijay,*Tristan Stubbs,Vipraj Nigam",
  GT: "Anuj Rawat,*Glenn Phillips,Gurnoor Singh Brar,Ishant Sharma,Jayant Yadav,*Jos Buttler,*Kagiso Rabada,Kumar Kushagra,Manav Suthar,Mohammad Siraj,Mohd. Arshad Khan,Nishant Sindhu,Prasidh Krishna,R. Sai Kishore,Rahul Tewatia,*Rashid Khan,Sai Sudharsan,Shahrukh Khan,Shubman Gill,Washington Sundar",
  KKR: "Ajinkya Rahane,Angkrish Raghuvanshi,Anukul Roy,Harshit Rana,Manish Pandey,Ramandeep Singh,Rinku Singh,*Rovman Powell,*Sunil Narine,Umran Malik,Vaibhav Arora,Varun Chakaravarthy",
  LSG: "Abdul Samad,*Aiden Markram,Akash Singh,Arjun Tendulkar (T),Arshin Kulkarni,Avesh Khan,Ayush Badoni,Digvesh Rathi,Himmat Singh,Manimaran Siddharth,*Matthew Breetzke,Mayank Yadav,Md Shami (T),*Mitchell Marsh,Mohsin Khan,*Nicholas Pooran,Prince Yadav,Rishabh Pant,Shahbaz Ahmed",
  MI: "*Allah Ghazanfar,Ashwani Kumar,*Corbin Bosch,Deepak Chahar,Hardik Pandya,Jasprit Bumrah,Mayank Markande (T),*Mitchell Santner,Naman Dhir,Raghu Sharma,Raj Angad Bawa,Robin Minz,Rohit Sharma,*Ryan Rickelton,Shardul Thakur (T),*Sherfane Rutherford (T),Suryakumar Yadav,Tilak Verma,*Trent Boult,*Will Jacks",
  PBKS: "Arshdeep Singh,*Azmatullah Omarzai,Harnoor Pannu,Harpreet Brar,*Lockie Ferguson,*Marco Jansen,*Marcus Stoinis,*Mitch Owen,Musheer Khan,Nehal Wadhera,Prabhsimran Singh,Priyansh Arya,Pyla Avinash,Shashank Singh,Shreyas Iyer,Suryansh Shedge,Vishnu Vinod,Vyshak Vijaykumar,*Xavier Bartlett,Yash Thakur,Yuzvendra Chahal",
  RR: "Dhruv Jurel,*Donovan Ferreira (T),*Jofra Archer,*Kwena Maphaka,*Lhuan-Dre Pretorious,*Nandre Burger,Ravindra Jadeja (T),Riyan Parag,*Sam Curran (T),Sandeep Sharma,*Shimron Hetmyer,Shubham Dubey,Tushar Deshpande,Vaibhav Suryavanshi,Yashaswi Jaiswal,Yudhvir Charak",
  RCB: "Abhinandan Singh,Bhuvneshwar Kumar,Devdutt Padikkal,*Jacob Bethell,Jitesh Sharma,*Josh Hazlewood,Krunal Pandya,*Nuwan Thushara,*Phil Salt,Rajat Patidar,Rasikh Dar,*Romario Shepherd,Suyash Sharma,Swapnil Singh,*Tim David,Virat Kohli,Yash Dayal",
  SRH: "Abhishek Sharma,Aniket Verma,*Brydon Carse,*Eshan Malinga,Harsh Dubey,Harshal Patel,*Heinrich Klaasen,Ishan Kishan,Jaydev Unadkat,*Kamindu Mendis,Nitish Kumar Reddy,*Pat Cummins,Smaran Ravichandaran,*Travis Head,Zeeshan Ansari"
};

const playerAliases = new Map([
  ["syed khaleel ahmed", "khaleel ahmed"],
  ["tilak verma", "tilak varma"],
  ["varun chakaravarthy", "varun chakravarthy"],
  ["r sai kishore", "sai kishore"],
  ["md shami", "mohammed shami"],
  ["vyshak vijaykumar", "vijaykumar vyshak"],
  ["allah mohammad ghazanfar", "allah ghazanfar"],
  ["mitch owen", "mitchell owen"],
  ["lhuan dre pretorius", "lhuan dre pretorius"],
  ["yashaswi jaiswal", "yashasvi jaiswal"],
  ["mohammad siraj", "mohammed siraj"],
  ["vaibhav suryavanshi", "vaibhav sooryavanshi"],
  ["rasikh dar salam", "rasikh dar"],
  ["arshad khan", "mohammed arshad khan"],
  ["mohd arshad khan", "mohammed arshad khan"],
  ["lhuan dre pretorious", "lhuan dre pretorius"]
]);

function normalizedName(name) {
  const normalized = name.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return playerAliases.get(normalized) ?? normalized;
}

export const FRANCHISE_SEED_LISTS = Object.freeze({
  CSK: "Ruturaj Gaikwad,Ayush Mhatre,Dewald Brevis,MS Dhoni,Urvil Patel,Shivam Dube,Jamie Overton,Ramakrishna Ghosh,Noor Ahmad,Khaleel Ahmed,Anshul Kamboj,Gurjapneet Singh,Nathan Ellis,Shreyas Gopal,Mukesh Choudhary,Sanju Samson,Akeal Hosein,Prashant Veer,Kartik Sharma,Matthew Short,Aman Khan,Sarfaraz Khan,Matt Henry,Rahul Chahar,Zak Foulkes",
  MI: "Rohit Sharma,Suryakumar Yadav,Tilak Varma,Robin Minz,Ryan Rickelton,Hardik Pandya,Naman Dhir,Mitchell Santner,Will Jacks,Corbin Bosch,Raj Angad Bawa,Trent Boult,Jasprit Bumrah,Deepak Chahar,Ashwani Kumar,Raghu Sharma,Allah Mohammad Ghazanfar,Shardul Thakur,Sherfane Rutherford,Mayank Markande,Quinton de Kock,Danish Malewar,Mohammad Izhar,Atharva Ankolekar,Mayank Rawat",
  RCB: "Phil Salt,Virat Kohli,Devdutt Padikkal,Rajat Patidar,Jitesh Sharma,Tim David,Jordan Cox,Romario Shepherd,Krunal Pandya,Jacob Bethell,Kanishk Chouhan,Venkatesh Iyer,Swapnil Singh,Vihaan Malhotra,Mangesh Yadav,Bhuvneshwar Kumar,Abhinandan Singh,Jacob Duffy,Suyash Sharma,Rasikh Dar Salam,Nuwan Thushara,Satvik Deswal,Josh Hazlewood,Yash Dayal,Vicky Ostwal,Richard Gleeson",
  KKR: "Ajinkya Rahane,Angkrish Raghuvanshi,Anukul Roy,Harshit Rana,Manish Pandey,Ramandeep Singh,Rinku Singh,Rovman Powell,Sunil Narine,Umran Malik,Vaibhav Arora,Varun Chakaravarthy,Cameron Green,Matheesha Pathirana,Mustafizur Rahman,Tejasvi Dahiya,Rachin Ravindra,Finn Allen,Tim Seifert,Akash Deep,Rahul Tripathi,Daksh Kamra,Sarthak Ranjan,Prashant Solanki,Kartik Tyagi",
  SRH: "Pat Cummins,Travis Head,Abhishek Sharma,Aniket Verma,Smaran Ravichandaran,Ishan Kishan,Heinrich Klaasen,Nitish Kumar Reddy,Harsh Dubey,Kamindu Mendis,Harshal Patel,Brydon Carse,Jaydev Unadkat,Eshan Malinga,Zeeshan Ansari,Salil Arora,Shivang Kumar,Liam Livingstone,RS Ambrish,David Payne,Sakib Hussain,Shivam Mavi,Amit Kumar,Praful Hinge,Krains Fuletra,Onkar Tukaram Tarmale,Dilshan Madushanka,Gerald Coetzee",
  RR: "Yashasvi Jaiswal,Vaibhav Sooryavanshi,Dhruv Jurel,Riyan Parag,Shimron Hetmyer,Shubham Dubey,Yudhvir Singh Charak,Jofra Archer,Tushar Deshpande,Sandeep Sharma,Kwena Maphaka,Nandre Burger,Lhuan-dre Pretorius,Donovan Ferreira,Ravindra Jadeja,Dasun Shanaka,Ravi Singh,Aman Rao Perala,Ravi Bishnoi,Brijesh Sharma,Sushant Mishra,Vignesh Puthur,Kuldeep Sen,Adam Milne,Yash Raj Punja,Emanjot Singh Chahal",
  PBKS: "Shreyas Iyer,Nehal Wadhera,Priyansh Arya,Prabhsimran Singh,Shashank Singh,Pyla Avinash,Harnoor Pannu,Musheer Khan,Vishnu Vinod,Marcus Stoinis,Azmatullah Omarzai,Suryansh Shedge,Mitchell Owen,Arshdeep Singh,Vyshak Vijaykumar,Yash Thakur,Xavier Bartlett,Lockie Ferguson,Yuzvendra Chahal,Harpreet Brar,Cooper Connolly,Praveen Dubey,Ben Dwarshuis,Vishal Nishad",
  GT: "Shubman Gill,Rashid Khan,Sai Sudharsan,Rahul Tewatia,Shahrukh Khan,Kagiso Rabada,Jos Buttler,Mohammed Siraj,Prasidh Krishna,Nishant Sindhu,Kumar Kushagra,Anuj Rawat,Manav Suthar,Washington Sundar,Arshad Khan,Gurnoor Singh Brar,Sai Kishore,Ishant Sharma,Jayant Yadav,Glenn Phillips,Ashok Sharma,Jason Holder,Tom Banton,Connor Esterhuizen,Luke Wood,Kulwant Khejroliya",
  LSG: "Rishabh Pant,Abdul Samad,Ayush Badoni,Aiden Markram,Mitchell Marsh,Matthew Breetzke,Nicholas Pooran,Himmat Singh,Shahbaz Ahmed,Arshin Kulkarni,Mayank Yadav,Avesh Khan,Mohsin Khan,Digvesh Rathi,Manimaran Siddharth,Prince Yadav,Akash Singh,Arjun Tendulkar,Mohammed Shami,Mukul Choudhary,Akshat Raghuwanshi,Josh Inglis,Wanindu Hasaranga,George Linde,Anrich Nortje,Naman Tiwari",
  DC: "KL Rahul,Tristan Stubbs,Sameer Rizvi,Karun Nair,Abishek Porel,Ashutosh Sharma,Vipraj Nigam,Madhav Tiwari,Tripurana Vijay,Ajay Mandal,Kuldeep Yadav,Mitchell Starc,T. Natarajan,Mukesh Kumar,Dushmantha Chameera,Nitish Rana,Axar Patel,Auqib Nabi Dar,Pathum Nissanka,David Miller,Ben Duckett,Lungi Ngidi,Sahil Parakh,Prithvi Shaw,Kyle Jamieson,Rehan Ahmed"
});

const baseByName = new Map(basePlayers.map((player) => [normalizedName(player.name), player]));
let generatedSequence = sequence;
export const IPL_2026_RETAINED_PLAYERS = Object.entries(retainedNamesByTeam).flatMap(([teamCode, names]) =>
  names.split(",").map((entry) => {
    const sourceName = entry.trim();
    const traded = sourceName.endsWith(" (T)");
    const withoutTradeMarker = traded ? sourceName.slice(0, -4) : sourceName;
    const overseas = withoutTradeMarker.startsWith("*");
    const name = overseas ? withoutTradeMarker.slice(1) : withoutTradeMarker;
    return {
      teamCode,
      name,
      sourceName,
      overseas,
      traded,
      source: IPL_2026_RETAINED_SOURCE
    };
  })
);

export const PLAYERS = (() => {
  const byId = new Map(basePlayers.map((player) => [player.id, player]));
  const recordedIds = new Set();
  for (const record of IPL_2026_RETAINED_PLAYERS) {
    const existing = baseByName.get(normalizedName(record.name));
    const player = existing ?? {
      id: `ipl-2026-${normalizedName(record.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      name: record.name,
      nationalityGroup: record.overseas ? "Overseas" : "India",
      nationalityStatus: "2026 IPL official retention list; overseas marker verified",
      isOverseas: record.overseas,
      role: "unknown",
      roleStatus: "not established by the cited 2026 retention announcement",
      category: "Grade C",
      basePrice: 50,
      rating: Math.max(55, Math.min(95, 66 + ((++generatedSequence * 17 + 11) % 29))),
      ratingLabel: "Simulated game rating (not an official prediction)",
      capped: null,
      cappedStatus: "unknown; not verified against a specific season",
      age: null,
      historicalTeams: null,
      historicalStats: null,
      auctionEligibility: "not asserted",
      battingHand: null,
      bowlingStyle: null,
      secondaryRole: null,
      dataSource: "Player identity from IPL 2026 official retention announcement; other fields are unknown or simulated",
      dataSeason: null,
      portrait: null,
      portraitStatus: "unavailable; local initials fallback"
    };
    if (recordedIds.has(player.id)) throw new Error(`Duplicate IPL 2026 retention record: ${record.name}`);
    recordedIds.add(player.id);
    byId.set(player.id, {
      ...player,
      nationalityGroup: record.overseas ? "Overseas" : "India",
      nationalityStatus: "IPL 2026 official retention announcement; overseas marker verified",
      isOverseas: record.overseas,
      season2026FranchiseCode: record.teamCode,
      season2026AssociationStatus: "verified",
      season2026SquadStatus: "retained",
      season2026TradeStatus: record.traded ? "traded" : "not-marked-as-traded",
      season2026SourceName: record.sourceName,
      season2026Source: record.source,
      originalFranchiseCode: null,
      originalFranchiseStatus: "unknown",
      previousFranchiseCode: null,
      previousFranchiseStatus: "unknown",
      retentionEligible: true,
      auctionStatus: "retained-before-2026-auction",
      currentOwner: null,
      basePriceStatus: "simulated"
    });
  }
  const byCanonicalName = new Map([...byId.values()].map((player) => [normalizedName(player.name), player]));
  for (const [franchiseCode, playerNames] of Object.entries(FRANCHISE_SEED_LISTS)) {
    for (const seedName of playerNames.split(",")) {
      const canonicalName = normalizedName(seedName);
      let player = byCanonicalName.get(canonicalName);
      if (!player) {
        const id = `seed-${canonicalName.replace(/\s+/g, "-")}`;
        player = {
          id,
          name: seedName,
          aliases: [],
          nationalityGroup: "Unknown",
          nationalityStatus: "unverified",
          isOverseas: null,
          role: "unknown",
          roleStatus: "unverified",
          category: null,
          categoryStatus: "unavailable",
          basePrice: null,
          rating: null,
          ratingLabel: null,
          capped: null,
          cappedStatus: "unknown",
          age: null,
          historicalTeams: null,
          historicalStats: null,
          statsVerified: false,
          auctionEligibility: "not asserted",
          battingHand: null,
          bowlingStyle: null,
          secondaryRole: null,
          dataSource: "User-supplied simulation seed list; roster membership is unverified",
          dataSeason: null,
          season2026FranchiseCode: null,
          season2026AssociationStatus: "unknown",
          season2026SquadStatus: "unknown",
          season2026TradeStatus: "unknown",
          season2026SourceName: null,
          season2026Source: null,
          originalFranchiseCode: null,
          originalFranchiseStatus: "unknown",
          previousFranchiseCode: null,
          previousFranchiseStatus: "unknown",
          seedFranchiseCodes: [],
          seedAssociationStatus: "unverified",
          retentionEligible: false,
          auctionStatus: "not-configured",
          currentOwner: null,
          basePriceStatus: "unavailable",
          portrait: null,
          portraitStatus: "unavailable; local initials fallback"
        };
        byId.set(id, player);
        byCanonicalName.set(canonicalName, player);
      }
      const aliases = new Set(player.aliases ?? []);
      if (seedName !== player.name) aliases.add(seedName);
      const seedFranchiseCodes = new Set(player.seedFranchiseCodes ?? []);
      seedFranchiseCodes.add(franchiseCode);
      const updated = {
        ...player,
        aliases: [...aliases],
        seedFranchiseCodes: [...seedFranchiseCodes],
        seedAssociationStatus: "unverified"
      };
      byId.set(player.id, updated);
      byCanonicalName.set(canonicalName, updated);
    }
  }
  return [...byId.values()].map(buildPlayerProfile);
})();

export function resolvePlayerAlias(name, players = PLAYERS) {
  const canonicalName = normalizedName(name);
  return players.find((player) =>
    normalizedName(player.name) === canonicalName ||
    (player.aliases ?? []).some((alias) => normalizedName(alias) === canonicalName)
  ) ?? null;
}

export function validatePlayers(players = PLAYERS) {
  const errors = [];
  const ids = new Set();
  const names = new Set();
  const roles = new Set(["batter", "wicketkeeper", "allrounder", "bowler", "unknown"]);
  const categories = new Set(["Grade A", "Grade B", "Grade C"]);
  for (const player of players) {
    if (!player.id || ids.has(player.id)) errors.push(`Duplicate or missing ID: ${player.id}`);
    if (!player.name || names.has(player.name)) errors.push(`Duplicate or missing name: ${player.name}`);
    if (!roles.has(player.role)) errors.push(`Invalid role for ${player.name}: ${player.role}`);
    if (player.category !== null && !categories.has(player.category) && !player.category.startsWith("Marquee ")) errors.push(`Invalid category for ${player.name}: ${player.category}`);
    if (player.category === null &&
        (player.categoryStatus !== "unavailable" || player.basePrice !== null)) {
      errors.push(`Missing unavailable-category status for ${player.name}`);
    }
    if (player.basePrice !== null && (!Number.isInteger(player.basePrice) || player.basePrice < 20)) errors.push(`Invalid base price for ${player.name}`);
    if (player.basePrice === null && player.basePriceStatus !== "unavailable") errors.push(`Missing unavailable-price status for ${player.name}`);
    if (!player.dataSource) errors.push(`Missing source metadata for ${player.name}`);
    if (player.capped === null && !player.cappedStatus) errors.push(`Missing capped-status disclosure for ${player.name}`);
    if (!player.auctionEligibility) errors.push(`Missing eligibility disclosure for ${player.name}`);
    ids.add(player.id);
    names.add(player.name);
  }
  errors.push(...validateVerifiedStatRecords(VERIFIED_STAT_RECORDS, players));
  return errors;
}
