// Invented test fixture
load Wide16And.hdl,
output-file Wide16And.out,
compare-to Wide16And.cmp,
output-list a%B1.16.1 b%B1.16.1 out%B1.16.1 out%X1.4.1;

set a %B0000000000000000, set b %B0000000000000000, eval, output;
set a %B1111111111111111, set b %B1111111111111111, eval, output;
set a %B1010101010101010, set b %B1111000011110000, eval, output;
set a %B0000000000000001, set b %B1000000000000001, eval, output;
