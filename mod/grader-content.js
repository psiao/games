// ===========================================================================
// grader-content.js — "Are You Smarter Than a School Grader?" question bank.
// Only the HOST loads this file, so answers stay off players' devices.
// Organized by GRADE (1-5) -> SUBJECT -> array of { q, a:[4 options], c:correctIndex }.
// Grade-appropriate: Grade 1 is very basic, Grade 5 is upper-elementary.
// ===========================================================================
export const SUBJECTS = ["Math", "Science", "English", "Geography", "History"];
export const GRADES = [5, 6, 7, 8];
export const GRADE_LABEL = { 5: "Grade 5", 6: "Grade 6", 7: "Grade 7", 8: "Grade 8" };

export const QUESTIONS = {
  5: {
    Math: [
      { q: "What is the square root of 169?", a: ["12", "13", "14", "15"], c: 1 },
      { q: "Solve using order of operations: 8 + 4 × 3", a: ["36", "20", "24", "14"], c: 1 },
      { q: "What is 40% of 150?", a: ["45", "60", "75", "50"], c: 1 },
      { q: "What is 7³ (7 cubed)?", a: ["49", "147", "343", "721"], c: 2 },
      { q: "What is 2/3 of 90?", a: ["45", "60", "30", "120"], c: 1 },
      { q: "What is 15 × 12?", a: ["170", "180", "150", "210"], c: 1 },
    ],
    Science: [
      { q: "What is the chemical symbol for water?", a: ["CO2", "H2O", "O2", "NaCl"], c: 1 },
      { q: "What is the chemical symbol for gold?", a: ["Gd", "Au", "Go", "Ag"], c: 1 },
      { q: "What do we call an animal that eats both plants and meat?", a: ["Herbivore", "Carnivore", "Omnivore", "Producer"], c: 2 },
      { q: "What gas makes up most of Earth's atmosphere?", a: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], c: 1 },
      { q: "What type of rock forms from cooled magma or lava?", a: ["Sedimentary", "Igneous", "Metamorphic", "Fossil"], c: 1 },
      { q: "How many chambers does the human heart have?", a: ["2", "3", "4", "6"], c: 2 },
    ],
    English: [
      { q: "What is an exaggeration for effect (e.g., 'I've told you a million times') called?", a: ["Simile", "Hyperbole", "Metaphor", "Idiom"], c: 1 },
      { q: "Which sentence is written in the passive voice?", a: ["The dog chased the ball.", "The ball was chased by the dog.", "Chase the ball!", "The dog runs fast."], c: 1 },
      { q: "What is the suffix in the word 'careful'?", a: ["care", "ful", "ca", "ful care"], c: 1 },
      { q: "What do you call the turning point or most exciting part of a story?", a: ["Setting", "Climax", "Prologue", "Index"], c: 1 },
      { q: "Which word is a conjunction?", a: ["Because", "Table", "Green", "Slowly"], c: 0 },
      { q: "A word that means the opposite of another is a(n)?", a: ["Synonym", "Antonym", "Homophone", "Acronym"], c: 1 },
    ],
    Geography: [
      { q: "What is the smallest country in the world?", a: ["Monaco", "Vatican City", "San Marino", "Malta"], c: 1 },
      { q: "What is the capital of Australia?", a: ["Sydney", "Melbourne", "Canberra", "Perth"], c: 2 },
      { q: "What is the capital of Brazil?", a: ["Rio de Janeiro", "São Paulo", "Brasília", "Buenos Aires"], c: 2 },
      { q: "The Sahara Desert is located on which continent?", a: ["Asia", "Australia", "Africa", "South America"], c: 2 },
      { q: "What is the capital of Turkey?", a: ["Istanbul", "Ankara", "Izmir", "Bursa"], c: 1 },
      { q: "Which two continents does the Ural range separate?", a: ["Africa and Asia", "Europe and Asia", "Europe and Africa", "Asia and Australia"], c: 1 },
    ],
    History: [
      { q: "Who wrote the Declaration of Independence's first draft?", a: ["George Washington", "Thomas Jefferson", "Benjamin Franklin", "John Adams"], c: 1 },
      { q: "Which ancient civilization built Machu Picchu?", a: ["Aztec", "Maya", "Inca", "Roman"], c: 2 },
      { q: "Who led the nonviolent movement for India's independence?", a: ["Nelson Mandela", "Mahatma Gandhi", "Martin Luther King Jr.", "Winston Churchill"], c: 1 },
      { q: "The U.S. Civil War was mainly fought over which issue?", a: ["Taxes on tea", "Slavery", "Land in Canada", "Oil"], c: 1 },
      { q: "Who was the first man to walk on the Moon?", a: ["Buzz Aldrin", "Yuri Gagarin", "Neil Armstrong", "Michael Collins"], c: 2 },
      { q: "In which country did the Renaissance begin?", a: ["France", "England", "Italy", "Spain"], c: 2 },
    ],
  },
  6: {
    Math: [
      { q: "Solve for x: 3x + 7 = 22.", a: ["3", "5", "7", "15"], c: 1 },
      { q: "What is the least common multiple (LCM) of 6 and 8?", a: ["24", "48", "12", "14"], c: 0 },
      { q: "What is 3⁴ (3 to the power of 4)?", a: ["12", "64", "81", "27"], c: 2 },
      { q: "A $40 shirt is 25% off. What is the sale price?", a: ["$30", "$35", "$10", "$25"], c: 0 },
      { q: "What is the greatest common factor (GCF) of 12 and 18?", a: ["3", "6", "9", "12"], c: 1 },
    ],
    Science: [
      { q: "What is the powerhouse of the cell?", a: ["Nucleus", "Ribosome", "Mitochondria", "Vacuole"], c: 2 },
      { q: "Which blood cells help fight infection?", a: ["Red blood cells", "White blood cells", "Platelets", "Plasma"], c: 1 },
      { q: "How many bones are in the adult human body?", a: ["201", "206", "212", "198"], c: 1 },
      { q: "What is the pH of a neutral solution?", a: ["0", "7", "14", "1"], c: 1 },
      { q: "What process do plants use to make food from sunlight?", a: ["Respiration", "Photosynthesis", "Digestion", "Fermentation"], c: 1 },
    ],
    English: [
      { q: "In 'She sings beautifully,' what part of speech is 'beautifully'?", a: ["Adjective", "Adverb", "Verb", "Noun"], c: 1 },
      { q: "What is the plural of 'goose'?", a: ["Gooses", "Geese", "Goosen", "Geeses"], c: 1 },
      { q: "A group of words containing a subject and a verb is called a?", a: ["Phrase", "Clause", "Fragment", "Prefix"], c: 1 },
      { q: "Which word is a preposition?", a: ["Quickly", "Beneath", "Happy", "Jump"], c: 1 },
      { q: "What punctuation joins two independent clauses without a conjunction?", a: ["Comma", "Semicolon", "Colon", "Hyphen"], c: 1 },
    ],
    Geography: [
      { q: "Which is the longest river in the world?", a: ["Amazon", "Nile", "Yangtze", "Mississippi"], c: 1 },
      { q: "Mount Kilimanjaro is located in which country?", a: ["Kenya", "Tanzania", "Ethiopia", "Uganda"], c: 1 },
      { q: "What is the capital of Egypt?", a: ["Cairo", "Alexandria", "Giza", "Luxor"], c: 0 },
      { q: "Which is the largest ocean on Earth?", a: ["Atlantic", "Indian", "Pacific", "Arctic"], c: 2 },
      { q: "The Great Barrier Reef lies off the coast of which country?", a: ["Brazil", "Australia", "Mexico", "Indonesia"], c: 1 },
    ],
    History: [
      { q: "Which ancient civilization built the pyramids of Giza?", a: ["Romans", "Greeks", "Egyptians", "Persians"], c: 2 },
      { q: "Who was the last active pharaoh of ancient Egypt, allied with Rome?", a: ["Nefertiti", "Cleopatra", "Hatshepsut", "Isis"], c: 1 },
      { q: "The ancient Olympic Games originated in which country?", a: ["Italy", "Greece", "Egypt", "Turkey"], c: 1 },
      { q: "Which empire was ruled by Julius Caesar?", a: ["Greek", "Roman", "Ottoman", "Mongol"], c: 1 },
      { q: "The Great Wall was built to protect which ancient country?", a: ["Japan", "China", "India", "Persia"], c: 1 },
    ],
  },
  7: {
    Math: [
      { q: "Solve for x: 5x − 3 = 2x + 12.", a: ["3", "5", "7", "15"], c: 1 },
      { q: "What is (−6) × (−4)?", a: ["−24", "24", "−10", "10"], c: 1 },
      { q: "What is the area of a triangle with base 10 and height 6?", a: ["60", "30", "16", "32"], c: 1 },
      { q: "What is the value of 5! (5 factorial)?", a: ["25", "120", "60", "20"], c: 1 },
      { q: "What is ¾ ÷ ½?", a: ["3/8", "1.5", "2/3", "1/4"], c: 1 },
    ],
    Science: [
      { q: "What is the chemical symbol for sodium?", a: ["So", "Na", "S", "Sd"], c: 1 },
      { q: "How many protons does a carbon atom have?", a: ["4", "6", "8", "12"], c: 1 },
      { q: "Which subatomic particle carries a negative charge?", a: ["Proton", "Neutron", "Electron", "Nucleus"], c: 2 },
      { q: "At sea level, water boils at what temperature in Fahrenheit?", a: ["100°F", "180°F", "212°F", "32°F"], c: 2 },
      { q: "What is the most common state of matter in the universe?", a: ["Solid", "Liquid", "Gas", "Plasma"], c: 3 },
    ],
    English: [
      { q: "Giving human traits to non-human things is called?", a: ["Hyperbole", "Personification", "Onomatopoeia", "Irony"], c: 1 },
      { q: "What is the repetition of initial consonant sounds called?", a: ["Assonance", "Alliteration", "Rhyme", "Meter"], c: 1 },
      { q: "Which word means 'to make something less severe'?", a: ["Aggravate", "Mitigate", "Amplify", "Provoke"], c: 1 },
      { q: "A word that imitates a sound (e.g., 'buzz') is an example of?", a: ["Metaphor", "Onomatopoeia", "Pun", "Idiom"], c: 1 },
      { q: "What is the term for the main character of a story?", a: ["Antagonist", "Protagonist", "Narrator", "Foil"], c: 1 },
    ],
    Geography: [
      { q: "What is the capital of Switzerland?", a: ["Zurich", "Geneva", "Bern", "Basel"], c: 2 },
      { q: "Which strait separates Europe and Asia in Turkey?", a: ["Gibraltar", "Bosphorus", "Hormuz", "Malacca"], c: 1 },
      { q: "What is the capital of New Zealand?", a: ["Auckland", "Wellington", "Christchurch", "Hamilton"], c: 1 },
      { q: "The Andes mountain range runs along which continent?", a: ["Africa", "Asia", "South America", "Europe"], c: 2 },
      { q: "Which country has the most natural lakes in the world?", a: ["Russia", "Canada", "USA", "Finland"], c: 1 },
    ],
    History: [
      { q: "In which year did World War II end?", a: ["1918", "1939", "1945", "1950"], c: 2 },
      { q: "The French Revolution began in which year?", a: ["1776", "1789", "1804", "1815"], c: 1 },
      { q: "Which explorer reached the Americas in 1492?", a: ["Magellan", "Columbus", "Vasco da Gama", "Cook"], c: 1 },
      { q: "The Berlin Wall fell in which year?", a: ["1979", "1989", "1991", "1995"], c: 1 },
      { q: "Who was the first Emperor of Rome?", a: ["Julius Caesar", "Augustus", "Nero", "Constantine"], c: 1 },
    ],
  },
  8: {
    Math: [
      { q: "If 2x² = 50 and x is positive, what is x?", a: ["5", "10", "25", "2.5"], c: 0 },
      { q: "A right triangle has legs 3 and 4. What is the hypotenuse?", a: ["5", "7", "6", "12"], c: 0 },
      { q: "What is the slope of the line y = 3x − 2?", a: ["−2", "3", "2", "1/3"], c: 1 },
      { q: "What is √144 + √25?", a: ["17", "13", "169", "7"], c: 0 },
      { q: "Simplify: 2³ × 2⁴.", a: ["128", "64", "512", "256"], c: 0 },
    ],
    Science: [
      { q: "What is the SI unit of force?", a: ["Joule", "Newton", "Watt", "Pascal"], c: 1 },
      { q: "What is the chemical formula for table salt?", a: ["NaCl", "KCl", "NaOH", "HCl"], c: 0 },
      { q: "Approximately how fast does light travel in a vacuum?", a: ["3,000 km/s", "30,000 km/s", "300,000 km/s", "3,000,000 km/s"], c: 2 },
      { q: "What is the most abundant element in the universe?", a: ["Oxygen", "Carbon", "Hydrogen", "Helium"], c: 2 },
      { q: "What type of bond involves the sharing of electrons?", a: ["Ionic", "Covalent", "Metallic", "Hydrogen"], c: 1 },
    ],
    English: [
      { q: "What does 'ubiquitous' mean?", a: ["Rare", "Present everywhere", "Ancient", "Hidden"], c: 1 },
      { q: "A word or phrase that reads the same backward (e.g., 'level') is a?", a: ["Anagram", "Palindrome", "Homonym", "Acronym"], c: 1 },
      { q: "Which word means 'brief and to the point'?", a: ["Verbose", "Concise", "Vague", "Elaborate"], c: 1 },
      { q: "What does the prefix 'omni-' mean?", a: ["Against", "All", "Before", "Around"], c: 1 },
      { q: "The subjunctive mood is used mainly to express?", a: ["Facts", "Commands", "Hypotheticals or wishes", "Questions"], c: 2 },
    ],
    Geography: [
      { q: "What is the capital of Kazakhstan?", a: ["Almaty", "Astana", "Bishkek", "Tashkent"], c: 1 },
      { q: "What is the world's largest country by area?", a: ["Canada", "China", "Russia", "USA"], c: 2 },
      { q: "What is the capital of Morocco?", a: ["Casablanca", "Rabat", "Marrakesh", "Fez"], c: 1 },
      { q: "Lake Baikal, the world's deepest lake, is in which country?", a: ["Mongolia", "Russia", "China", "Kazakhstan"], c: 1 },
      { q: "The Atacama, the driest desert on Earth, is mostly in which country?", a: ["Peru", "Chile", "Argentina", "Bolivia"], c: 1 },
    ],
    History: [
      { q: "In which year was the U.S. Declaration of Independence signed?", a: ["1774", "1776", "1781", "1789"], c: 1 },
      { q: "Who co-wrote 'The Communist Manifesto'?", a: ["Lenin", "Karl Marx", "Stalin", "Adam Smith"], c: 1 },
      { q: "The Magna Carta was signed in which year?", a: ["1066", "1215", "1348", "1492"], c: 1 },
      { q: "Which empire was founded by Genghis Khan?", a: ["Ottoman", "Mongol", "Persian", "Byzantine"], c: 1 },
      { q: "The Renaissance is most associated with which Italian city?", a: ["Rome", "Venice", "Florence", "Milan"], c: 2 },
    ],
  },
};
