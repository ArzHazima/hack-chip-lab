// Invented test fixture
load Pick4of16.hdl,
output-file Pick4of16.out,
compare-to Pick4of16.cmp,
output-list a%X1.4.1 b%X1.4.1 c%X1.4.1 d%X1.4.1 sel%D2.1.2 out%X1.4.1;

set a %X1111, set b %X2222, set c %X3333, set d %X4444,
set sel 0, eval, output;
set sel 1, eval, output;
set sel 2, eval, output;
set sel 3, eval, output;
set a %XABCD, set sel 0, eval, output;
